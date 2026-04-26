import type { AppConfig } from "../config.js";
import { buildToolContext } from "../utils/prompting.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { CapabilityRouter } from "./capabilityRouter.js";
import type { IntentFlags } from "./workflowEngine.js";

export interface RuntimeContextResult {
  runtimeContext: string;
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

  async build(userText: string, intentFlags: IntentFlags): Promise<RuntimeContextResult> {
    const context = await this.router.buildContext(userText, intentFlags);
    const runtimeContext = buildToolContext({
      ontologySummary: context.ontologySummary,
      exampleSummary: context.exampleSummary,
      catalogueSummary: context.catalogueSummary,
      graphDbSummary: context.graphDbSummary,
      workflowOverride: context.workflowOverride
    });
    return { runtimeContext, warnings: context.warnings, debug: context.debug };
  }
}
