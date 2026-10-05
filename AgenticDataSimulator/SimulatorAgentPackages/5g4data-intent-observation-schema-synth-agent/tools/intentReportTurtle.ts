import { randomBytes } from "node:crypto";

export type IntentHandlingStateIri =
  | "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateIntentReceived"
  | "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateCompliant"
  | "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateDegraded";

export interface BuildIntentReportInput {
  intentId: string;
  handlingState: IntentHandlingStateIri;
  reportNumber: number;
  generatedAt: Date;
  reason?: string;
}

function normalizeIntentLocalName(intentId: string): string {
  const trimmed = intentId.trim();
  if (/^I[a-f0-9]{32}$/iu.test(trimmed)) {
    return `I${trimmed.slice(1).toLowerCase()}`;
  }
  if (/^[a-f0-9]{32}$/iu.test(trimmed)) {
    return `I${trimmed.toLowerCase()}`;
  }
  return trimmed.replace(/^data5g:/iu, "");
}

function stateLocal(iri: IntentHandlingStateIri): string {
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function uniqueReportLocalName(): string {
  return `IR${randomBytes(16).toString("hex")}`;
}

export function buildIntentReportTurtle(input: BuildIntentReportInput): string {
  const intentLocal = normalizeIntentLocalName(input.intentId);
  const reportLocal = uniqueReportLocalName();
  const instant = input.generatedAt.toISOString();
  const state = stateLocal(input.handlingState);
  const reasonBlock =
    input.reason?.trim()
      ? `  icm:reason "${input.reason.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" ;\n`
      : "";

  return `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix t: <http://www.w3.org/2006/time#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:${reportLocal}
  a icm:IntentReport ;
  icm:about data5g:${intentLocal} ;
  icm:intentHandlingState imo:${state} ;
  icm:reportNumber "${Math.max(1, Math.floor(input.reportNumber))}"^^xsd:positiveInteger ;
  icm:reportGenerated [
    a t:Instant ;
    t:inXSDDateTimeStamp "${instant}"^^xsd:dateTimeStamp
  ] ;
${reasonBlock}  .
`.trimEnd();
}
