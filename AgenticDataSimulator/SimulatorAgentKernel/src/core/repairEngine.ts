import {
  collectOutputIssues,
  extractTurtlePayload,
  looksLikeTurtleIntent
} from "./outputPolicyValidator.js";
import { isReviewTurnOutput } from "./confirmationState.js";
import type { LlmCallRecord, ModelInvocationResult, ModelInvokeOptions } from "../models.js";
import type { LoadedDomainPackage, ValidatorRules } from "./packageLoader.js";
import type { IntentFlags } from "./workflowEngine.js";
import { runConfiguredPostprocessors } from "./postprocessorRunner.js";
import { traceToolCall } from "../tracing/mlflowTracing.js";

export interface RepairContext {
  runtimeContext: string;
  userPrompt?: string;
  knownMetricStems?: string[];
  intentFlags: IntentFlags;
  validatorRules: ValidatorRules;
  domainPackage: LoadedDomainPackage;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
  confirmationAck?: boolean;
  assistantMarkers?: string[];
}

function pickNonConfirmedFallbackText(
  candidates: string[],
  assistantMarkers?: string[]
): string {
  for (const candidate of candidates) {
    if (candidate.trim().length === 0) continue;
    if (isReviewTurnOutput(candidate, assistantMarkers)) return candidate;
  }
  for (const candidate of candidates) {
    if (candidate.trim().length > 0) return candidate;
  }
  return candidates[0] ?? "";
}

export class RepairEngine {
  constructor(
    private readonly invokeModel: (
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
      options?: ModelInvokeOptions
    ) => Promise<ModelInvocationResult>
  ) {}

  private normalizeCandidateText(text: string): string {
    if (!looksLikeTurtleIntent(text)) return text;
    return extractTurtlePayload(text);
  }

  private collectIssues(text: string, context: RepairContext): string[] {
    return collectOutputIssues({
      text,
      runtimeContext: context.runtimeContext,
      intentFlags: context.intentFlags,
      validatorRules: context.validatorRules,
      confirmationAck: context.confirmationAck,
      assistantMarkers: context.assistantMarkers
    });
  }

  async repairIfNeeded(
    responseText: string,
    context: RepairContext,
    systemBlocks: string[],
    history: Array<{ role: "user" | "assistant"; content: string }>,
    invokeOptions: ModelInvokeOptions = { stage: "repair" }
  ): Promise<{ text: string; debug: string[]; calls: LlmCallRecord[] }> {
    const debug: string[] = [];
    const calls: LlmCallRecord[] = [];
    const normalizedInput = this.normalizeCandidateText(responseText);
    const preprocessed = await traceToolCall("postprocessors", { when: "always" }, () =>
      runConfiguredPostprocessors({
        text: normalizedInput,
        context: {
          runtimeContext: context.runtimeContext,
          userPrompt: context.userPrompt,
          knownMetricStems: context.knownMetricStems,
          intentFlags: context.intentFlags,
          validatorRules: context.validatorRules,
          reportingIntervalMinutes: context.reportingIntervalMinutes,
          reportingIntervalSeconds: context.reportingIntervalSeconds
        },
        domainPackage: context.domainPackage,
        when: "always",
        debug
      })
    );
    const issues = await traceToolCall(
      "output_policy_validate",
      { confirmationAck: context.confirmationAck ?? false },
      async () => this.collectIssues(preprocessed, context)
    );
    if (issues.length === 0) {
      return { text: this.normalizeCandidateText(preprocessed), debug, calls };
    }
    debug.push("output_policy_violation_detected=true");
    const issuesBlock = issues.map((i) => `- ${i}`).join("\n");
    const repairInstruction = `Your previous response violated output policy.
Rewrite now following all rules exactly. Return either:
1) concise summary + confirmation question (if not confirmed), or
2) final Turtle intent (only if user confirmed), or
3) at most 2 concise clarifying questions.

Validation failures to fix:
${issuesBlock}

Return final Turtle only as raw @prefix blocks with no narration, markdown fences, or prose before/after the Turtle.

Previous invalid response:
${preprocessed}`;
    const repaired = await this.invokeModel(
      [
        ...systemBlocks.map((content) => ({ role: "system" as const, content })),
        ...history,
        { role: "user" as const, content: repairInstruction }
      ],
      invokeOptions
    );
    calls.push(repaired.call);
    const repostprocessed = await runConfiguredPostprocessors({
      text: this.normalizeCandidateText(repaired.text),
      context: {
        runtimeContext: context.runtimeContext,
        userPrompt: context.userPrompt,
        knownMetricStems: context.knownMetricStems,
        intentFlags: context.intentFlags,
        validatorRules: context.validatorRules,
        reportingIntervalMinutes: context.reportingIntervalMinutes,
        reportingIntervalSeconds: context.reportingIntervalSeconds
      },
      domainPackage: context.domainPackage,
      when: "always",
      debug
    });
    const postRepairIssues = this.collectIssues(repostprocessed, context);
    if (postRepairIssues.length === 0) {
      return { text: this.normalizeCandidateText(repostprocessed), debug, calls };
    }
    debug.push("output_repair_still_invalid=true");
    debug.push(`output_repair_failure_issues=${postRepairIssues.join(" | ")}`);
    if (!context.confirmationAck) {
      const fallback = pickNonConfirmedFallbackText(
        [repostprocessed, repaired.text, preprocessed, responseText],
        context.assistantMarkers
      );
      debug.push("output_repair_non_confirmed_fallback=true");
      return { text: fallback, debug, calls };
    }
    const issueSummary = postRepairIssues.map((issue) => `- ${issue}`).join("\n");
    return {
      text: `I cannot produce a valid final Turtle intent yet. Validation still failed after repair:\n${issueSummary}\n\nCheck runtime grounding (catalogue workload, GraphDB locality) or ask me to regenerate with strict validation.`,
      debug,
      calls
    };
  }
}
