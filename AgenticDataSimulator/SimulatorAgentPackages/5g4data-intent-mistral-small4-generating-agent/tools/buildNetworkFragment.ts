import type { IntentDraft } from "./assembleIntent.js";
import {
  DEFAULT_NETWORK_BANDWIDTH_MBPS,
  DEFAULT_NETWORK_LATENCY_MS
} from "./postprocess/networkDefaults.js";
import {
  parseReportingIntervalMinutes,
  reportingEventLabel
} from "./fragmentContextParse.js";
import {
  buildNetworkConditionBlock,
  buildNetworkExpectationBlock,
  buildScopedReportingBlocks
} from "./fragmentTurtleEmit.js";

const CO_BANDWIDTH = "CO__ID_CONDITION_BANDWIDTH_1__";
const CO_LATENCY = "CO__ID_CONDITION_LATENCY_1__";
const NE_LOCAL = "NE__ID_NETWORK_1__";
const RE_LOCAL = "RE__ID_REPORTING_NETWORK_1__";

function sharedCxLocalFromDraft(draft: IntentDraft): string | null {
  for (const fragment of draft.fragments) {
    const cx = fragment.locals.find((local) => local.startsWith("CX"));
    if (cx) return cx;
    const match = fragment.turtle.match(/\bdata5g:(CX[A-Za-z0-9_]+)\s+a\b/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function buildNetworkFragment(input: {
  draft: IntentDraft;
  reportingIntervalHint: string;
}): string {
  const sharedCx = sharedCxLocalFromDraft(input.draft);
  const intervalMinutes = parseReportingIntervalMinutes(input.reportingIntervalHint);
  const intervalLabel = reportingEventLabel(intervalMinutes);
  const coLocals = [CO_BANDWIDTH, CO_LATENCY];

  const blocks = [
    buildNetworkConditionBlock({
      stem: "bandwidth",
      coLocal: CO_BANDWIDTH,
      threshold: DEFAULT_NETWORK_BANDWIDTH_MBPS,
      unit: "mbit/s",
      quantifier: "quan:larger"
    }),
    buildNetworkConditionBlock({
      stem: "latency",
      coLocal: CO_LATENCY,
      threshold: DEFAULT_NETWORK_LATENCY_MS,
      unit: "ms",
      quantifier: "quan:smaller"
    }),
    buildNetworkExpectationBlock({
      neLocal: NE_LOCAL,
      coLocals,
      cxLocal: sharedCx
    }),
    buildScopedReportingBlocks({
      scope: "network",
      expectationLocal: NE_LOCAL,
      reLocal: RE_LOCAL,
      firstCoOrCeLocal: CO_BANDWIDTH,
      intervalMinutes,
      intervalLabel,
      description: "Network observation reports on the configured interval."
    })
  ];

  return blocks.join("\n\n");
}
