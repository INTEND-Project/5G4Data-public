import type { IntentDraft } from "./assembleIntent.js";
import {
  parseReportingIntervalMinutes,
  reportingEventLabel
} from "./fragmentContextParse.js";
import {
  buildConditionBlock,
  buildScopedReportingBlocks,
  buildSustainabilityExpectationBlock
} from "./fragmentTurtleEmit.js";
import { parseSustainabilityObjectives } from "./parseCatalogueObjectives.js";

const CO_LOCALS = [
  "CO__ID_CONDITION_SUST_1__",
  "CO__ID_CONDITION_SUST_2__",
  "CO__ID_CONDITION_SUST_3__"
];
const SE_LOCAL = "SE__ID_SUSTAINABILITY_1__";
const RE_LOCAL = "RE__ID_REPORTING_SUSTAINABILITY_1__";

function sharedCxLocalFromDraft(draft: IntentDraft): string | null {
  for (const fragment of draft.fragments) {
    const cx = fragment.locals.find((local) => local.startsWith("CX"));
    if (cx) return cx;
  }
  return null;
}

export function buildSustainabilityFragment(input: {
  draft: IntentDraft;
  runtimeContext: string;
  reportingIntervalHint: string;
}): string {
  const objectives = parseSustainabilityObjectives(input.runtimeContext);
  if (objectives.length === 0) {
    throw new Error("sustainability stub: no sustainability objectives in runtime context");
  }

  const sharedCx = sharedCxLocalFromDraft(input.draft);
  const intervalMinutes = parseReportingIntervalMinutes(input.reportingIntervalHint);
  const intervalLabel = reportingEventLabel(intervalMinutes);

  const coLocals: string[] = [];
  const blocks: string[] = [];

  for (let i = 0; i < objectives.length; i += 1) {
    const metric = objectives[i]!;
    const coLocal = CO_LOCALS[i];
    if (!coLocal) break;
    coLocals.push(coLocal);
    blocks.push(buildConditionBlock(metric, coLocal));
  }

  blocks.push(
    buildSustainabilityExpectationBlock({
      seLocal: SE_LOCAL,
      coLocals,
      cxLocal: sharedCx,
      intervalMinutes
    })
  );

  blocks.push(
    buildScopedReportingBlocks({
      scope: "sustainability",
      expectationLocal: SE_LOCAL,
      reLocal: RE_LOCAL,
      firstCoOrCeLocal: coLocals[0]!,
      intervalMinutes,
      intervalLabel,
      description: "Sustainability observation reports on the configured interval."
    })
  );

  return blocks.join("\n\n");
}
