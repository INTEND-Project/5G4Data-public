import {
  buildDeploymentDescriptorUrl,
  parseChartInfo,
  parseReportingIntervalMinutes,
  reportingEventLabel,
  resolveDataCenter
} from "./fragmentContextParse.js";
import {
  buildConditionBlock,
  buildContextBlock,
  buildDeploymentExpectationBlock,
  buildScopedReportingBlocks
} from "./fragmentTurtleEmit.js";
import { parseDeploymentObjectives } from "./parseCatalogueObjectives.js";

const CO_LOCALS = ["CO__ID_CONDITION_1__", "CO__ID_CONDITION_2__", "CO__ID_CONDITION_3__"];
const CX_LOCAL = "CX__ID_CONTEXT_1__";
const DE_LOCAL = "DE__ID_DEPLOYMENT_1__";
const RE_LOCAL = "RE__ID_REPORTING_DEPLOYMENT_1__";

export function buildDeploymentFragment(input: {
  runtimeContext: string;
  reportingIntervalHint: string;
  userPrompt?: string;
  selectedDataCenter?: string | null;
}): string {
  const objectives = parseDeploymentObjectives(input.runtimeContext);
  if (objectives.length === 0) {
    throw new Error("deployment stub: no deployment objectives in runtime context");
  }

  const chart = parseChartInfo(input.runtimeContext);
  const dataCenter = resolveDataCenter(input.runtimeContext, input.selectedDataCenter);
  if (!dataCenter) {
    throw new Error("deployment stub: no data center in GraphDB context");
  }

  const intervalMinutes = parseReportingIntervalMinutes(input.reportingIntervalHint);
  const intervalLabel = reportingEventLabel(intervalMinutes);
  const application = chart?.chartName ?? "rusty-llm";
  const descriptor = buildDeploymentDescriptorUrl(input.runtimeContext, chart);

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
    buildContextBlock({
      cxLocal: CX_LOCAL,
      application,
      dataCenter,
      deploymentDescriptor: descriptor
    })
  );

  blocks.push(
    buildDeploymentExpectationBlock({
      deLocal: DE_LOCAL,
      coLocals,
      cxLocal: CX_LOCAL,
      intervalMinutes
    })
  );

  blocks.push(
    buildScopedReportingBlocks({
      scope: "deployment",
      expectationLocal: DE_LOCAL,
      reLocal: RE_LOCAL,
      firstCoOrCeLocal: coLocals[0]!,
      intervalMinutes,
      intervalLabel,
      description: "Deployment observation reports on the configured interval."
    })
  );

  return blocks.join("\n\n");
}
