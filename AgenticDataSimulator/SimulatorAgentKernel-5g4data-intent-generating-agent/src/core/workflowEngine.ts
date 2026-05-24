import type { LoadedDomainPackage } from "./packageLoader.js";

export interface IntentFlags {
  deployment: boolean;
  locality: boolean;
  networkQos: boolean;
  [key: string]: boolean;
}

export class WorkflowEngine {
  constructor(private readonly domainPackage: LoadedDomainPackage) {}

  classifyIntent(userText: string): IntentFlags {
    const lowered = userText.toLowerCase();
    const flags: IntentFlags = {
      deployment: false,
      locality: false,
      networkQos: false
    };
    for (const [flag, signals] of Object.entries(this.domainPackage.classificationRules.intentFlags)) {
      flags[flag] = signals.some((signal) => lowered.includes(signal.toLowerCase()));
    }
    return flags;
  }

  modulesForTurn(intentFlags: IntentFlags, stageHint: "default" | "repair" = "default"): string[] {
    const modules = new Set<string>();
    for (const stage of this.domainPackage.workflow.stages) {
      if (stageHint === "repair" && stage.id !== "repair" && stage.id !== "base") {
        continue;
      }
      if (stageHint !== "repair" && stage.id === "repair") {
        continue;
      }
      if (
        stage.whenIntentFlags &&
        stage.whenIntentFlags.length > 0 &&
        !stage.whenIntentFlags.some((flag) => intentFlags[flag])
      ) {
        continue;
      }
      for (const moduleName of stage.includeModules) {
        modules.add(moduleName);
      }
    }
    return [...modules];
  }
}
