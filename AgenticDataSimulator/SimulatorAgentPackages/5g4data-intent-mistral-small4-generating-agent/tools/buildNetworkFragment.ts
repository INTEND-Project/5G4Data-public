import type { IntentDraft } from "./assembleIntent.js";
import {
  parseNetworkQosFromUserPrompt,
  parseReportingIntervalMinutes,
  reportingEventLabel
} from "./fragmentContextParse.js";
import {
  buildNetworkConditionBlock,
  buildNetworkExpectationBlock,
  buildRegionContextBlocks,
  buildScopedReportingBlocks
} from "./fragmentTurtleEmit.js";
import {
  DEFAULT_NETWORK_BANDWIDTH_MBPS,
  DEFAULT_NETWORK_LATENCY_MS
} from "./postprocess/networkDefaults.js";

const CO_BANDWIDTH = "CO__ID_CONDITION_BANDWIDTH_1__";
const CO_LATENCY = "CO__ID_CONDITION_LATENCY_1__";
const NE_LOCAL = "NE__ID_NETWORK_1__";
const RE_LOCAL = "RE__ID_REPORTING_NETWORK_1__";
const CX_REGION_LOCAL = "CX__ID_CONTEXT_REGION_1__";
const RG_LOCAL = "RG__ID_REGION_1__";

function sharedCxLocalFromDraft(draft: IntentDraft): string | null {
  for (const fragment of draft.fragments) {
    const cx = fragment.locals.find((local) => local.startsWith("CX"));
    if (cx) return cx;
    const match = fragment.turtle.match(/\bdata5g:(CX[A-Za-z0-9_]+)\s+a\b/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

export interface NetworkFragmentOptions {
  draft: IntentDraft;
  reportingIntervalHint: string;
  userPrompt?: string;
  /** Override default 300 mbit/s (quan:atLeast). */
  bandwidthMbps?: number;
  /** Override default 50 ms (quan:smaller). */
  latencyMs?: number;
  /** When set, emit appliesToRegion + geo:Feature polygon instead of shared deployment CX. */
  region?: {
    placeLabel: string;
    customer: string;
    wkt: string;
  } | null;
}

export function buildNetworkFragment(input: NetworkFragmentOptions): string {
  const qos = parseNetworkQosFromUserPrompt(input.userPrompt);
  const bandwidthMbps = input.bandwidthMbps ?? qos.bandwidthMbps ?? DEFAULT_NETWORK_BANDWIDTH_MBPS;
  const latencyMs = input.latencyMs ?? qos.latencyMs ?? DEFAULT_NETWORK_LATENCY_MS;
  const intervalMinutes = parseReportingIntervalMinutes(input.reportingIntervalHint);
  const intervalLabel = reportingEventLabel(intervalMinutes);
  const coLocals = [CO_BANDWIDTH, CO_LATENCY];

  const blocks: string[] = [
    buildNetworkConditionBlock({
      stem: "bandwidth",
      coLocal: CO_BANDWIDTH,
      threshold: bandwidthMbps,
      unit: "mbit/s",
      quantifier: "quan:atLeast"
    }),
    buildNetworkConditionBlock({
      stem: "latency",
      coLocal: CO_LATENCY,
      threshold: latencyMs,
      unit: "ms",
      quantifier: "quan:smaller"
    })
  ];

  let cxLocal: string | null = null;
  if (input.region?.wkt) {
    blocks.push(
      buildRegionContextBlocks({
        cxLocal: CX_REGION_LOCAL,
        rgLocal: RG_LOCAL,
        customer: input.region.customer,
        placeLabel: input.region.placeLabel,
        wkt: input.region.wkt
      })
    );
    cxLocal = CX_REGION_LOCAL;
  } else {
    cxLocal = sharedCxLocalFromDraft(input.draft);
  }

  blocks.push(
    buildNetworkExpectationBlock({
      neLocal: NE_LOCAL,
      coLocals,
      cxLocal
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
  );

  return blocks.join("\n\n");
}
