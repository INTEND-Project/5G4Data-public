import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AgentTurnResult, ChatMessage, ChatSession } from "../models.js";
import { buildSystemPrompt } from "../utils/prompting.js";
import {
  assistantRequestedConfirmation,
  isConfirmationText,
  lastSubstantiveUserRequest
} from "./confirmationState.js";
import { looksLikeTurtleIntent } from "./outputPolicyValidator.js";
import { RepairEngine } from "./repairEngine.js";
import { RuntimeContextBuilder } from "./runtimeContextBuilder.js";
import { ShaclValidatorTool } from "./shaclValidatorTool.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export class TurnOrchestrator {
  private readonly contextBuilder: RuntimeContextBuilder;
  private readonly shaclValidator: ShaclValidatorTool;
  private readonly repairEngine: RepairEngine;
  private readonly systemPrompt: string;

  constructor(
    private readonly config: AppConfig,
    skillText: string,
    systemPromptText: string,
    private readonly invokeModel: (messages: ModelMessage[]) => Promise<string>
  ) {
    this.contextBuilder = new RuntimeContextBuilder(config);
    this.shaclValidator = new ShaclValidatorTool(config.shaclShapesFile);
    this.repairEngine = new RepairEngine(invokeModel);
    this.systemPrompt = buildSystemPrompt(systemPromptText, skillText);
  }

  async runTurn(session: ChatSession, userText: string): Promise<AgentTurnResult> {
    const debug: string[] = [];
    const warnings: string[] = [];
    const confirmationAck = isConfirmationText(userText) && assistantRequestedConfirmation(session);
    const effectiveUserText =
      confirmationAck && lastSubstantiveUserRequest(session) ? (lastSubstantiveUserRequest(session) as string) : userText;
    const context = await this.contextBuilder.build(effectiveUserText);
    warnings.push(...context.warnings);
    debug.push(...context.debug, `confirmation_acknowledged=${confirmationAck}`);

    session.messages.push({ role: "user", text: userText, createdAt: new Date().toISOString() });

    const systemBlocks = [
      this.systemPrompt,
      this.outputPolicyInstruction(),
      this.fixedDefaultsInstruction(),
      this.humanReviewInstruction(),
      `Use this runtime grounding context when relevant. If it conflicts with your assumptions, trust it.\n\n${context.runtimeContext}`
    ];
    if (confirmationAck) {
      systemBlocks.push(
        "The user has explicitly confirmed. Do not ask for confirmation again. Generate the final Turtle intent now."
      );
    }

    const history = session.messages.map((m) => ({ role: m.role, content: m.text })) as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    let text = await this.invokeModel([
      ...systemBlocks.map((content) => ({ role: "system" as const, content })),
      ...history
    ]);

    const repaired = await this.repairEngine.repairIfNeeded(
      text,
      { runtimeContext: context.runtimeContext, userText: effectiveUserText },
      systemBlocks,
      history
    );
    text = repaired.text;
    debug.push(...repaired.debug);

    text = this.validateAndRepairWithShacl({
      text,
      warnings,
      debug,
      runtimeContext: context.runtimeContext
    });

    session.messages.push({ role: "assistant", text, createdAt: new Date().toISOString() });
    debug.push(`session_messages_after_assistant=${session.messages.length}`, `turn_id=${randomUUID()}`);
    return { response: text, warnings, debug };
  }

  private validateAndRepairWithShacl(args: {
    text: string;
    warnings: string[];
    debug: string[];
    runtimeContext: string;
  }): string {
    if (!looksLikeTurtleIntent(args.text)) return args.text;
    if (!this.config.shaclShapesFile) return args.text;
    let current = args.text;
    for (let attempt = 0; attempt <= this.config.shaclMaxRetries; attempt += 1) {
      const result = this.shaclValidator.validateTurtle(current);
      args.debug.push(`shacl_attempt=${attempt + 1} conforms=${result.conforms}`);
      if (result.conforms) {
        args.warnings.push(attempt > 0 ? "SHACL validation passed after automatic repair." : "SHACL validation passed.");
        return current;
      }
      if (attempt >= this.config.shaclMaxRetries) {
        args.warnings.push("Final intent did not pass SHACL validation after retry attempts.");
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

  private outputPolicyInstruction(): string {
    return [
      "Output policy (strict):",
      "- Do not narrate actions or progress.",
      "- If sufficient data exists, return only final Turtle intent.",
      "- If critical data is missing, ask at most 2 concise questions and stop.",
      "- Never output placeholders like <uuid4>."
    ].join("\n");
  }

  private fixedDefaultsInstruction(): string {
    return [
      "Fixed defaults policy (strict):",
      `- Always set imo:handler to "${this.config.defaultIntentHandler}".`,
      `- Always set imo:owner to "${this.config.defaultIntentOwner}".`,
      `- ${this.config.autoGenerateDescription ? "Always generate a plausible dct:description." : "Use provided dct:description only."}`,
      "- Do not ask user for handler, owner, or description."
    ].join("\n");
  }

  private humanReviewInstruction(): string {
    return [
      "Human review policy (strict):",
      "- Before Turtle generation, provide concise generation summary.",
      "- End summary by asking user to confirm or adjust.",
      "- Generate Turtle only after explicit user confirmation."
    ].join("\n");
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
