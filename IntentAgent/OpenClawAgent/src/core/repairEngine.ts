import {
  collectOutputIssues
} from "./outputPolicyValidator.js";
import type { LlmCallRecord, ModelInvocationResult } from "../models.js";
import type { LoadedDomainPackage, ValidatorRules } from "./packageLoader.js";
import type { IntentFlags } from "./workflowEngine.js";
import { runConfiguredPostprocessors } from "./postprocessorRunner.js";

export interface RepairContext {
  runtimeContext: string;
  intentFlags: IntentFlags;
  validatorRules: ValidatorRules;
  domainPackage: LoadedDomainPackage;
}

export class RepairEngine {
  constructor(
    private readonly invokeModel: (
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
      metadata?: { stage: string }
    ) => Promise<ModelInvocationResult>
  ) {}

  async repairIfNeeded(
    responseText: string,
    context: RepairContext,
    systemBlocks: string[],
    history: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<{ text: string; debug: string[]; calls: LlmCallRecord[] }> {
    const debug: string[] = [];
    const calls: LlmCallRecord[] = [];
    const preprocessed = await runConfiguredPostprocessors({
      text: responseText,
      context: {
        runtimeContext: context.runtimeContext,
        intentFlags: context.intentFlags,
        validatorRules: context.validatorRules
      },
      domainPackage: context.domainPackage,
      when: "always",
      debug
    });
    const issues = collectOutputIssues({
      text: preprocessed,
      runtimeContext: context.runtimeContext,
      intentFlags: context.intentFlags,
      validatorRules: context.validatorRules
    });
    if (issues.length === 0) return { text: preprocessed, debug, calls };
    debug.push("output_policy_violation_detected=true");
    const issuesBlock = issues.map((i) => `- ${i}`).join("\n");
    const repairInstruction = `Your previous response violated output policy.
Rewrite now following all rules exactly. Return either:
1) concise summary + confirmation question (if not confirmed), or
2) final Turtle intent (only if user confirmed), or
3) at most 2 concise clarifying questions.

Validation failures to fix:
${issuesBlock}

Previous invalid response:
${preprocessed}`;
    const repaired = await this.invokeModel(
      [
        ...systemBlocks.map((content) => ({ role: "system" as const, content })),
        ...history,
        { role: "user" as const, content: repairInstruction }
      ],
      { stage: "repair" }
    );
    calls.push(repaired.call);
    const secondIssues = collectOutputIssues({
      text: repaired.text,
      runtimeContext: context.runtimeContext,
      intentFlags: context.intentFlags,
      validatorRules: context.validatorRules
    });
    if (secondIssues.length > 0) {
      const postprocessed = await runConfiguredPostprocessors({
        text: repaired.text,
        context: {
          runtimeContext: context.runtimeContext,
          intentFlags: context.intentFlags,
          validatorRules: context.validatorRules
        },
        domainPackage: context.domainPackage,
        when: "on_validation_failure",
        debug
      });
      const postprocessIssues = collectOutputIssues({
        text: postprocessed,
        runtimeContext: context.runtimeContext,
        intentFlags: context.intentFlags,
        validatorRules: context.validatorRules
      });
      if (postprocessIssues.length === 0) {
        return { text: postprocessed, debug, calls };
      }
      debug.push("output_repair_still_invalid=true");
      debug.push(`output_repair_failure_issues=${postprocessIssues.join(" | ")}`);
      return {
        text: "I cannot produce a valid final Turtle intent yet. Please provide missing deployment/network constraints or ask me to regenerate with strict validation.",
        debug,
        calls
      };
    }
    return { text: repaired.text, debug, calls };
  }
}
