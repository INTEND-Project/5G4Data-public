import type { IntentDraft, IntentDraftFragment } from "./assembleIntent.js";
import { selectCoordinationMetrics } from "./selectCoordinationMetrics.js";

const CE_LOCAL = "CE__ID_COORDINATION_1__";
const RE_LOCAL = "RE__ID_REPORTING_COORDINATION_1__";

function findExpectationLocal(fragment: IntentDraftFragment, prefix: "DE" | "SE" | "NE"): string | null {
  for (const local of fragment.locals) {
    if (local.startsWith(prefix)) return local;
  }
  const match = fragment.turtle.match(
    new RegExp(`\\bdata5g:(${prefix}[A-Za-z0-9_]+)\\s+a\\b`, "i")
  );
  return match?.[1] ?? null;
}

function reportingIntervalMinutes(draft: IntentDraft): number {
  for (const fragment of draft.fragments) {
    const match = fragment.turtle.match(/time:numericDuration\s+"(\d+)"/i);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 10;
}

function coordinateExpectations(draft: IntentDraft): string[] {
  const refs: string[] = [];
  const deployment = draft.fragments.find((f) => f.id === "deployment");
  const sustainability = draft.fragments.find((f) => f.id === "sustainability");
  const network = draft.fragments.find((f) => f.id === "network");

  const de = deployment ? findExpectationLocal(deployment, "DE") : null;
  const se = sustainability ? findExpectationLocal(sustainability, "SE") : null;
  const ne = network ? findExpectationLocal(network, "NE") : null;

  if (de) refs.push(de);
  if (se) refs.push(se);
  if (ne) refs.push(ne);
  return refs;
}

export function buildCoordinationFragment(input: {
  draft: IntentDraft;
  userPrompt: string;
}): string {
  const conditionLocals = selectCoordinationMetrics({
    draft: input.draft,
    userPrompt: input.userPrompt
  });
  if (conditionLocals.length === 0) {
    throw new Error("coordination stub: no condition locals found in prior fragments");
  }

  const coordinateLocals = coordinateExpectations(input.draft);
  if (coordinateLocals.length === 0) {
    throw new Error("coordination stub: no DE/SE/NE locals found in prior fragments");
  }

  const interval = reportingIntervalMinutes(input.draft);
  const conditionRefs = conditionLocals.map((local) => `data5g:${local}`).join(", ");
  const coordinateRefs = coordinateLocals.map((local) => `data5g:${local}`).join(",\n        ");

  return `data5g:U_coord a ut:UtilityFunction ;
    dct:description "coordination utility draft" .

data5g:${CE_LOCAL} a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf ${conditionRefs} ;
    ut:utility data5g:U_coord ;
    data5g:coordinates ${coordinateRefs} .

data5g:durationCoordination_${CE_LOCAL} a time:DurationDescription ;
    time:numericDuration "${interval}"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventCoordination_${CE_LOCAL} a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:durationCoordination_${CE_LOCAL} ) ;
    imo:eventFor data5g:${CE_LOCAL} .

data5g:${RE_LOCAL} a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventCoordination_${CE_LOCAL} ] .`;
}
