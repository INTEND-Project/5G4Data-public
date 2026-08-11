import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "../config.js";
import {
  clampReportingIntervalMinutes,
  clampReportingIntervalSeconds,
} from "../config.js";
import type {
  AgentTurnResult,
  ChatMessage,
  ChatSession,
  LlmCallRecord,
  ModelInvocationResult,
  ModelInvokeOptions
} from "../models.js";
import { extractTurtlePayload } from "./outputPolicyValidator.js";
import {
  ensureTurtlePrefixes,
  formatModelOnlyResponse,
  looksLikeModelOnlyTurtle
} from "./modelOnlyResponse.js";
import { RuntimeContextBuilder } from "./runtimeContextBuilder.js";
import { ShaclValidatorTool } from "./shaclValidatorTool.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { WorkflowEngine } from "./workflowEngine.js";
import { buildIntentUsageSummary } from "./usage.js";
import { appendUsageLog } from "./usageLogger.js";
import { tryReplPackageHook } from "./replPackageHook.js";
import {
  isMlflowTracingEnabled,
  normalizeStringRecord,
  previewText,
  traceAgentTurn,
  traceToolCall
} from "../tracing/mlflowTracing.js";
import { updateCurrentTrace } from "mlflow-tracing";
import { buildLlmTraceTags } from "../tracing/mlflowTracing.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export class TurnOrchestrator {
  private readonly contextBuilder: RuntimeContextBuilder;
  private readonly data5gShaclValidator: ShaclValidatorTool;
  private readonly tioShaclValidator: ShaclValidatorTool;
  private readonly workflowEngine: WorkflowEngine;

  constructor(
    private readonly config: AppConfig,
    private readonly domainPackage: LoadedDomainPackage,
    private readonly invokeModel: (
      messages: ModelMessage[],
      options?: ModelInvokeOptions
    ) => Promise<ModelInvocationResult>
  ) {
    this.contextBuilder = new RuntimeContextBuilder(config, domainPackage);
    this.data5gShaclValidator = new ShaclValidatorTool(config.shaclShapesFile, {
      applyCustomSparqlConstraints: true
    });
    this.tioShaclValidator = new ShaclValidatorTool(config.tioShaclShapesFile, {
      applyCustomSparqlConstraints: false
    });

    this.workflowEngine = new WorkflowEngine(domainPackage);
  }

  async runTurn(
    session: ChatSession,
    userText: string,
    hooks?: {
      replHookDebug?: boolean;
      replHookDebugLogPath?: string;
    }
  ): Promise<AgentTurnResult> {
    const turnId = randomUUID();
    return traceAgentTurn({
      sessionId: session.sessionId,
      turnId,
      userText,
      fn: () => this.executeTurn(session, userText, turnId, hooks)
    });
  }

  private async executeTurn(
    session: ChatSession,
    userText: string,
    turnId: string,
    hooks?: {
      replHookDebug?: boolean;
      replHookDebugLogPath?: string;
    }
  ): Promise<AgentTurnResult> {
    const debug: string[] = [];
    const warnings: string[] = [];
    const calls: LlmCallRecord[] = [];
    const hookDebug = hooks?.replHookDebug ?? false;
    const hookDebugLogPath = hooks?.replHookDebugLogPath ?? "logs/simulator-agent-debug.jsonl";

    const replHookResult = await tryReplPackageHook({
      line: userText.trim(),
      session,
      domainPackage: this.domainPackage,
      debug: hookDebug,
      debugLogPath: hookDebugLogPath,
      graphDbEndpoint: this.config.graphDbEndpoint,
      graphDbNamedGraph: this.config.graphDbNamedGraph,
      graphDbQueryLimit: this.config.graphDbQueryLimit,
      graphTargetBinding: session.graphTargetBinding ?? null,
      observationStorageOverride: session.observationStorage ?? null,
      createIntentStorage: session.createIntentStorage ?? null
    });

    if (replHookResult.handled) {
      if (isMlflowTracingEnabled()) {
        updateCurrentTrace({
          tags: { "turn.path": "repl_package_hook" }
        });
      }
      session.messages.push({ role: "user", text: userText, createdAt: new Date().toISOString() });
      if (replHookResult.assistantText) {
        session.messages.push({
          role: "assistant",
          text: replHookResult.assistantText,
          createdAt: new Date().toISOString()
        });
      }
      debug.push("repl_package_hook_handled=true");
      return {
        response: replHookResult.assistantText ?? "",
        warnings,
        debug
      };
    }

    const effectiveUserText = userText;
    const intentFlags = this.workflowEngine.classifyIntent(effectiveUserText);
    const context = await this.contextBuilder.build(
      effectiveUserText,
      intentFlags,
      session.graphTargetBinding ?? null
    );
    warnings.push(...context.warnings);
    debug.push(...context.debug, "confirmation_acknowledged=false", "model_only=true");

    let traceTags: Record<string, unknown> | undefined;
    let traceMetadata: Record<string, unknown> | undefined;
    if (isMlflowTracingEnabled()) {
      const selectedChartLine = context.debug.find((line) =>
        line.startsWith("selected_workload_chart=")
      );
      const selectedChart = selectedChartLine?.split("=")[1] ?? "";
      traceTags = {
        "turn.path": "model_only_main_turn",
        "turn.confirmation_ack": false,
        "intent.effective_user_text": effectiveUserText,
        "intent.flags.deployment": intentFlags.deployment,
        "intent.flags.locality": intentFlags.locality,
        "intent.flags.networkQos": intentFlags.networkQos,
        "intent.flags.sustainability": intentFlags.sustainability,
        "intent.flags.coordination": intentFlags.coordination,
        "intent.flags.observationReport": intentFlags.observationReport ?? false,
        "context.selected_chart": selectedChart,
        "session.observation_storage": session.observationStorage ?? "",
        "session.create_intent_storage": session.createIntentStorage ?? ""
      };
      traceMetadata = {
        runtime_context_preview: previewText(context.runtimeContext, 500)
      };
    }

    session.messages.push({ role: "user", text: userText, createdAt: new Date().toISOString() });

    // ModelOnly: system prompt + runtime grounding only (no prompt_modules / skill / reporting hints).
    const systemBlocks = [
      this.effectiveSystemPrompt(session),
      `Use this runtime grounding context when relevant. If it conflicts with your assumptions, trust it.\n\n${context.runtimeContext}`
    ];

    const history = session.messages.map((m) => ({ role: m.role, content: m.text })) as Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    const fewShots = this.sessionFewShotMessages(session);
    const mainResult = await this.invokeModel(
      [
        ...systemBlocks.map((content) => ({ role: "system" as const, content })),
        ...fewShots,
        ...history
      ],
      this.modelInvokeOptions(session, "main_turn")
    );
    calls.push(mainResult.call);
    if (traceTags) {
      Object.assign(traceTags, buildLlmTraceTags(mainResult.call));
    }
    debug.push(`main_turn_output=${mainResult.text}`);

    const rawText = mainResult.text;
    const extracted = extractTurtlePayload(rawText);
    const withPrefixes = ensureTurtlePrefixes(extracted, this.domainPackage.packageDir);
    const isTurtle = looksLikeModelOnlyTurtle(withPrefixes);
    let prettyTurtle = isTurtle ? withPrefixes : rawText;
    if (isTurtle && !extracted.includes("@prefix") && withPrefixes.includes("@prefix")) {
      debug.push("turtle_prefixes_injected=true");
    }

    if (isTurtle) {
      prettyTurtle = await traceToolCall("pretty_print_turtle", {}, async () => {
        const printed = await this.prettyPrintTurtle(withPrefixes);
        debug.push(
          printed === withPrefixes
            ? "pretty_print=unchanged_or_unavailable"
            : "pretty_print=ok"
        );
        return printed;
      });
      prettyTurtle = await traceToolCall("grounded_region_wkt", {}, async () => {
        const applied = await this.applyGroundedRegionWkt(
          prettyTurtle,
          context.runtimeContext
        );
        debug.push(
          applied === prettyTurtle
            ? "grounded_region_wkt=unchanged_or_unavailable"
            : "grounded_region_wkt=applied"
        );
        return applied;
      });
    }

    let tioResult = null as Awaited<ReturnType<ShaclValidatorTool["validateTurtle"]>> | null;
    let data5gResult = null as Awaited<ReturnType<ShaclValidatorTool["validateTurtle"]>> | null;

    if (isTurtle) {
      const dual = await traceToolCall(
        "shacl_validate_dual",
        {
          data5gShapesFile: this.config.shaclShapesFile,
          tioShapesFile: this.config.tioShaclShapesFile
        },
        async () => {
          const [tio, data5g] = await Promise.all([
            this.tioShaclValidator.validateTurtle(prettyTurtle),
            this.data5gShaclValidator.validateTurtle(prettyTurtle)
          ]);
          debug.push(
            `shacl_tio_conforms=${tio.conforms} violations=${tio.violations.length}`
          );
          debug.push(
            `shacl_data5g_conforms=${data5g.conforms} violations=${data5g.violations.length}`
          );
          if (!tio.conforms) {
            warnings.push(
              `TIO SHACL: non-conformant (${tio.violations.length} violation(s)).`
            );
          } else {
            warnings.push("TIO SHACL validation passed.");
          }
          if (!data5g.conforms) {
            warnings.push(
              `5g4data SHACL: non-conformant (${data5g.violations.length} violation(s)).`
            );
          } else {
            warnings.push("5g4data SHACL validation passed.");
          }
          return { tio, data5g };
        }
      );
      tioResult = dual.tio;
      data5gResult = dual.data5g;
    }

    const responseText = formatModelOnlyResponse({
      turtleOrText: prettyTurtle,
      isTurtle,
      tioResult,
      data5gResult
    });

    debug.push("graphdb_persist_skipped=model_only");
    const turtlePresent = isTurtle;
    if (isMlflowTracingEnabled() && traceTags) {
      Object.assign(traceTags, {
        "intent.turtle_present": turtlePresent,
        "shacl.tio_conforms": tioResult?.conforms ?? false,
        "shacl.data5g_conforms": data5gResult?.conforms ?? false,
        "graphdb.persisted": false
      });
      updateCurrentTrace({
        requestPreview: previewText(effectiveUserText),
        tags: normalizeStringRecord(traceTags),
        metadata: normalizeStringRecord(traceMetadata ?? {})
      });
    }

    session.messages.push({
      role: "assistant",
      text: responseText,
      createdAt: new Date().toISOString()
    });
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
    return {
      response: responseText,
      warnings,
      debug,
      intentUsageSummary,
      effectiveUserText,
      turtlePresent,
      confirmationAck: false,
      traceTags: traceTags ? normalizeStringRecord(traceTags) : undefined,
      traceMetadata: traceMetadata ? normalizeStringRecord(traceMetadata) : undefined
    };
  }

  getDomainPackage(): LoadedDomainPackage {
    return this.domainPackage;
  }

  getAppConfig(): AppConfig {
    return this.config;
  }

  private effectiveSystemPrompt(session: ChatSession): string {
    const override = session.systemPromptOverride?.trim();
    return override || this.domainPackage.systemPromptText;
  }

  private sessionFewShotMessages(
    session: ChatSession
  ): Array<{ role: "user" | "assistant"; content: string }> {
    return (
      session.fewShotMessagesOverride ??
      this.domainPackage.defaultFewShotMessages ??
      []
    );
  }

  private modelInvokeOptions(session: ChatSession, stage: string): ModelInvokeOptions {
    const numCtx =
      session.numCtxOverride ?? this.config.ollamaNumCtx ?? undefined;
    const stopSequences =
      session.stopSequencesOverride ??
      (this.config.llmStopSequences.length > 0 ? this.config.llmStopSequences : undefined);
    return {
      stage,
      llmModel: session.llmModelOverride ?? undefined,
      llmApiBaseUrl: session.llmApiBaseUrlOverride ?? undefined,
      temperature: session.temperatureOverride ?? undefined,
      numCtx,
      stopSequences
    };
  }

  async resolveWorkloadPreview(
    userText: string,
    graphTargetBinding?: import("../models.js").GraphTargetBinding | null
  ) {
    const intentFlags = this.workflowEngine.classifyIntent(userText);
    return this.contextBuilder.resolveWorkloadPreview(userText, intentFlags, graphTargetBinding);
  }

  private async prettyPrintTurtle(turtle: string): Promise<string> {
    for (const candidate of this.resolvePrettyPrintToolPaths()) {
      if (!existsSync(candidate)) continue;
      try {
        const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
        const fn = mod.prettyPrintIntentTurtle as ((raw: string) => string) | undefined;
        if (typeof fn !== "function") continue;
        const printed = fn(turtle);
        return typeof printed === "string" && printed.trim() ? printed : turtle;
      } catch {
        continue;
      }
    }
    return turtle;
  }

  /** Overwrite geo:asWKT POLYGON literals with Nominatim-grounded bbox from runtime context. */
  private async applyGroundedRegionWkt(turtle: string, runtimeContext: string): Promise<string> {
    for (const candidate of this.resolveLocalityToolPaths()) {
      if (!existsSync(candidate)) continue;
      try {
        const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
        const parse = mod.parseGroundedRegionWktFromRuntimeContext as
          | ((ctx: string) => string | null)
          | undefined;
        const apply = mod.applyGroundedRegionWktToTurtle as
          | ((ttl: string, wkt: string) => string)
          | undefined;
        if (typeof parse !== "function" || typeof apply !== "function") continue;
        const grounded = parse(runtimeContext);
        if (!grounded) return turtle;
        return apply(turtle, grounded);
      } catch {
        continue;
      }
    }
    return turtle;
  }

  private resolvePrettyPrintToolPaths(): string[] {
    const cloneToolPath = resolve(process.cwd(), "src", "tools", "prettyPrintIntentTurtle.ts");
    const packageToolPath = join(
      this.domainPackage.packageDir,
      "tools",
      "prettyPrintIntentTurtle.ts"
    );
    return [cloneToolPath, packageToolPath];
  }

  private resolveLocalityToolPaths(): string[] {
    const cloneToolPath = resolve(process.cwd(), "src", "tools", "localityTool.ts");
    const packageToolPath = join(this.domainPackage.packageDir, "tools", "localityTool.ts");
    return [cloneToolPath, packageToolPath];
  }
}

export type ReportingIntervalForPostprocessor = {
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
};

export function resolveReportingIntervalForPostprocessor(
  session: ChatSession,
  envDefaultMinutes: number
): ReportingIntervalForPostprocessor {
  if (session.reportingIntervalSecondsOverride != null) {
    return {
      reportingIntervalSeconds: clampReportingIntervalSeconds(
        session.reportingIntervalSecondsOverride
      )
    };
  }
  const minutes =
    session.reportingIntervalMinutesOverride != null
      ? clampReportingIntervalMinutes(session.reportingIntervalMinutesOverride)
      : clampReportingIntervalMinutes(envDefaultMinutes);
  return { reportingIntervalMinutes: minutes };
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
