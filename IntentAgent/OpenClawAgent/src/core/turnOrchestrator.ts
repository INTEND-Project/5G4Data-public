import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  AgentTurnResult,
  ChatMessage,
  ChatSession,
  LlmCallRecord,
  ModelInvocationResult
} from "../models.js";
import {
  assistantRequestedConfirmation,
  isConfirmationText,
  lastSubstantiveUserRequest
} from "./confirmationState.js";
import { looksLikeTurtleIntent } from "./outputPolicyValidator.js";
import { RepairEngine } from "./repairEngine.js";
import { RuntimeContextBuilder } from "./runtimeContextBuilder.js";
import { ShaclValidatorTool } from "./shaclValidatorTool.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { WorkflowEngine } from "./workflowEngine.js";
import { buildIntentUsageSummary } from "./usage.js";
import { appendUsageLog } from "./usageLogger.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export class TurnOrchestrator {
  private readonly contextBuilder: RuntimeContextBuilder;
  private readonly shaclValidator: ShaclValidatorTool;
  private readonly repairEngine: RepairEngine;
  private readonly workflowEngine: WorkflowEngine;

  constructor(
    private readonly config: AppConfig,
    private readonly domainPackage: LoadedDomainPackage,
  private readonly invokeModel: (
    messages: ModelMessage[],
    metadata?: { stage: string }
  ) => Promise<ModelInvocationResult>
  ) {
    this.contextBuilder = new RuntimeContextBuilder(config, domainPackage);
    this.shaclValidator = new ShaclValidatorTool(config.shaclShapesFile);
    this.repairEngine = new RepairEngine(invokeModel);
    this.workflowEngine = new WorkflowEngine(domainPackage);
  }

  async runTurn(session: ChatSession, userText: string): Promise<AgentTurnResult> {
    const debug: string[] = [];
    const warnings: string[] = [];
    const calls: LlmCallRecord[] = [];
    const turnId = randomUUID();
    const confirmationConfig = this.domainPackage.workflow.confirmation;
    const acceptedUserInputs = confirmationConfig?.acceptedUserInputs ?? ["ok"];
    const assistantMarkers = confirmationConfig?.assistantMarkers ?? ["type ok to confirm"];
    const confirmationAck =
      isConfirmationText(userText, acceptedUserInputs) &&
      assistantRequestedConfirmation(session, assistantMarkers);
    const previousUserRequest = lastSubstantiveUserRequest(session, acceptedUserInputs);
    const effectiveUserText =
      confirmationAck && previousUserRequest ? previousUserRequest : userText;
    const intentFlags = this.workflowEngine.classifyIntent(effectiveUserText);
    const context = await this.contextBuilder.build(effectiveUserText, intentFlags);
    warnings.push(...context.warnings);
    debug.push(...context.debug, `confirmation_acknowledged=${confirmationAck}`);

    session.messages.push({ role: "user", text: userText, createdAt: new Date().toISOString() });

    // Confirmation ack should keep normal generation-stage modules; repair stage is only for
    // policy/shacl rewrite flows and not for user confirmation handling.
    const stageHint = "default";
    const modules = this.workflowEngine.modulesForTurn(intentFlags, stageHint);
    const moduleBlocks = modules
      .map((name) => this.domainPackage.promptModules[name])
      .filter((text): text is string => Boolean(text))
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    const systemBlocks = [
      this.domainPackage.systemPromptText,
      ...moduleBlocks,
      `Use this runtime grounding context when relevant. If it conflicts with your assumptions, trust it.\n\n${context.runtimeContext}`
    ];
    if (confirmationAck) {
      systemBlocks.push(
        confirmationConfig?.forceGenerateInstruction ??
          "The user has explicitly confirmed. Do not ask for confirmation again. Generate the final Turtle intent now."
      );
    }

    const history = session.messages.map((m) => ({ role: m.role, content: m.text })) as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    const mainResult = await this.invokeModel(
      [
        ...systemBlocks.map((content) => ({ role: "system" as const, content })),
        ...history
      ],
      { stage: "main_turn" }
    );
    calls.push(mainResult.call);
    let text = mainResult.text;
    debug.push(`main_turn_output=${mainResult.text}`);

    const repaired = await this.repairEngine.repairIfNeeded(
      text,
      {
        runtimeContext: context.runtimeContext,
        intentFlags,
        validatorRules: this.domainPackage.validatorRules,
        domainPackage: this.domainPackage
      },
      systemBlocks,
      history
    );
    text = repaired.text;
    debug.push(...repaired.debug);
    debug.push(`post_repair_output=${text}`);
    calls.push(...repaired.calls);

    text = this.validateAndRepairWithShacl({
      text,
      warnings,
      debug,
      runtimeContext: context.runtimeContext
    });

    session.messages.push({ role: "assistant", text, createdAt: new Date().toISOString() });
    const intentUsageSummary = buildIntentUsageSummary(calls);
    if (intentUsageSummary && this.config.llmUsageLogPath) {
      appendUsageLog(this.config.llmUsageLogPath, {
        timestampUtc: new Date().toISOString(),
        sessionId: session.sessionId,
        turnId,
        usage: intentUsageSummary
      });
    }
    debug.push(`session_messages_after_assistant=${session.messages.length}`, `turn_id=${turnId}`);
    return { response: text, warnings, debug, intentUsageSummary };
  }

  private validateAndRepairWithShacl(args: {
    text: string;
    warnings: string[];
    debug: string[];
    runtimeContext: string;
  }): string {
    if (!looksLikeTurtleIntent(args.text)) return args.text;
    if (!this.config.shaclShapesFile) return args.text;
    let current = this.normalizeTurtleText(args.text);
    for (let attempt = 0; attempt <= this.config.shaclMaxRetries; attempt += 1) {
      const result = this.shaclValidator.validateTurtle(current);
      args.debug.push(`shacl_attempt=${attempt + 1} conforms=${result.conforms}`);
      if (result.conforms) {
        args.warnings.push(attempt > 0 ? "SHACL validation passed after automatic repair." : "SHACL validation passed.");
        return current;
      }
      if (attempt >= this.config.shaclMaxRetries) {
        args.warnings.push("Final intent did not pass SHACL validation after retry attempts.");
        args.debug.push(`shacl_final_report=${result.reportText}`);
        return `${current}

# SHACL validation result
# Non-conformant after repair attempts.
# ${result.reportText}`;
      }
      // Keep loop deterministic; repair prompt in full OpenClaw runtime can call model here.
      args.debug.push("shacl_repair_attempt_skipped_model_rewrite=true");
    }
    return current;
  }

  private normalizeTurtleText(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:turtle|ttl)?\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) {
      return fenced[1].trim();
    }
    return trimmed;
  }

}

export function createSession(sessionId?: string): ChatSession {
  return {
    sessionId: sessionId ?? `session_${randomUUID().replace(/-/g, "")}`,
    createdAt: new Date().toISOString(),
    messages: []
  };
}

export function addMessage(session: ChatSession, message: ChatMessage): void {
  session.messages.push(message);
}
