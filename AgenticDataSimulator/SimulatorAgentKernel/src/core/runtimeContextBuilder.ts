import type { AppConfig } from "../config.js";
import { buildToolContext } from "../utils/prompting.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { CapabilityRouter, type WorkloadPreviewResult } from "./capabilityRouter.js";
import type { IntentFlags } from "./workflowEngine.js";
import type { GraphTargetBinding } from "../models.js";

export interface RuntimeContextResult {
  runtimeContext: string;
  knownMetricStems: string[];
  warnings: string[];
  debug: string[];
}

export class RuntimeContextBuilder {
  private readonly router: CapabilityRouter;

  constructor(
    config: AppConfig,
    private readonly domainPackage: LoadedDomainPackage
  ) {
    this.router = new CapabilityRouter(config, domainPackage);
  }

  async build(
    userText: string,
    intentFlags: IntentFlags,
    graphTargetBinding?: GraphTargetBinding | null
  ): Promise<RuntimeContextResult> {
    const context = await this.router.buildContext(userText, intentFlags, graphTargetBinding);
    const runtimeContext = buildToolContext({
      ontologySummary: context.ontologySummary,
      exampleSummary: context.exampleSummary,
      catalogueSummary: context.catalogueSummary,
      graphDbSummary: context.graphDbSummary,
      workflowOverride: context.workflowOverride
    });
    return {
      runtimeContext,
      knownMetricStems: context.knownMetricStems,
      warnings: context.warnings,
      debug: context.debug
    };
  }

  async resolveWorkloadPreview(
    userText: string,
    intentFlags: IntentFlags,
    graphTargetBinding?: GraphTargetBinding | null
  ): Promise<WorkloadPreviewResult> {
    return this.router.resolveWorkloadPreview(userText, intentFlags, graphTargetBinding);
  }
}
