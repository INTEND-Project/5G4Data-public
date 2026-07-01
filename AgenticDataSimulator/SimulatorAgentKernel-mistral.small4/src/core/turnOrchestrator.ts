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
import {
  assistantRequestedConfirmation,
  isConfirmationText,
  lastSubstantiveUserRequest
} from "./confirmationState.js";
import { extractTurtlePayload, looksLikeTurtleIntent } from "./outputPolicyValidator.js";
import { RepairEngine } from "./repairEngine.js";
import { runConfiguredPostprocessors } from "./postprocessorRunner.js";
import { RuntimeContextBuilder } from "./runtimeContextBuilder.js";
import { ShaclValidatorTool } from "./shaclValidatorTool.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { FragmentGenerationEngine } from "./fragmentGenerationEngine.js";
import { adjustModulesForConfirmationAck, WorkflowEngine } from "./workflowEngine.js";
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
import {
  resolvePersistGraphTargetBinding,
  type GraphTargetBinding
} from "./graphTargetBinding.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
type GraphDbWriterApi = { insertTurtle: (turtle: string) => Promise<boolean> };

export class TurnOrchestrator {
  private readonly contextBuilder: RuntimeContextBuilder;
  private readonly shaclValidator: ShaclValidatorTool;
  private readonly repairEngine: RepairEngine;
  private readonly workflowEngine: WorkflowEngine;
  private readonly fragmentGenerationEngine: FragmentGenerationEngine;

  constructor(
    private readonly config: AppConfig,
    private readonly domainPackage: LoadedDomainPackage,
  private readonly invokeModel: (
    messages: ModelMessage[],
    options?: ModelInvokeOptions
  ) => Promise<ModelInvocationResult>
  ) {
    this.contextBuilder = new RuntimeContextBuilder(config, domainPackage);
    this.shaclValidator = new ShaclValidatorTool(config.shaclShapesFile);
    this.repairEngine = new RepairEngine(invokeModel);
    this.workflowEngine = new WorkflowEngine(domainPackage);
    this.fragmentGenerationEngine = new FragmentGenerationEngine();
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
    const hookDebugLogPath = hooks?.replHookDebugLogPath ?? "logs/openclaw-agent-debug.jsonl";

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
    const context = await this.contextBuilder.build(
      effectiveUserText,
      intentFlags,
      session.graphTargetBinding ?? null
    );
    warnings.push(...context.warnings);
    debug.push(...context.debug, `confirmation_acknowledged=${confirmationAck}`);

    let traceTags: Record<string, unknown> | undefined;
    let traceMetadata: Record<string, unknown> | undefined;
    if (isMlflowTracingEnabled()) {
      const selectedChartLine = context.debug.find((line) =>
        line.startsWith("selected_workload_chart=")
      );
      const selectedChart = selectedChartLine?.split("=")[1] ?? "";
      traceTags = {
        "turn.path": "llm_turn",
        "turn.confirmation_ack": confirmationAck,
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
        "runtime_context_preview": previewText(context.runtimeContext, 500)
      };
    }

    session.messages.push({ role: "user", text: userText, createdAt: new Date().toISOString() });

    const reportingInterval = resolveReportingIntervalForPostprocessor(
      session,
      this.config.intentReportIntervalMinutes
    );
    const reportingIntervalHint = buildReportingIntervalHint(reportingInterval);

    const history = session.messages.map((m) => ({ role: m.role, content: m.text })) as Array<{
      role: "user" | "assistant";
      content: string;
    }>;

    let text: string;
    let systemBlocks: string[];

    if (confirmationAck) {
      if (!this.domainPackage.workflow.generation) {
        throw new Error(
          "kernel-mistral.small4 requires workflow.generation.fragmented; package is missing generation config"
        );
      }
      const fragResult = await this.fragmentGenerationEngine.generate({
        session,
        domainPackage: this.domainPackage,
        intentFlags,
        effectiveUserText,
        runtimeContext: context.runtimeContext,
        reportingIntervalHint,
        invokeModel: (messages, options) => this.invokeModel(messages, options),
        modelInvokeOptions: (stage) => this.modelInvokeOptions(session, stage),
        debug
      });
      text = fragResult.text;
      calls.push(...fragResult.calls);
      systemBlocks = [
        this.domainPackage.systemPromptText,
        `Fragmented generation: ${fragResult.fragmentIds.join(", ")}`
      ];
      debug.push(`fragmented_generation_output_chars=${fragResult.assembledChars}`);
      if (traceTags) {
        const lastFragCall = fragResult.calls[fragResult.calls.length - 1];
        Object.assign(traceTags, {
          "generation.mode": "fragmented",
          "generation.fragment_count": String(fragResult.fragmentIds.length),
          "generation.fragment_ids": fragResult.fragmentIds.join(","),
          "generation.assembled_chars": String(fragResult.assembledChars)
        });
        if (lastFragCall) {
          Object.assign(traceTags, buildLlmTraceTags(lastFragCall));
        }
      }
    } else {
      session.intentDraft = undefined;
      const stageHint = "default";
      const modules = this.workflowEngine.modulesForTurn(intentFlags, stageHint);
      const moduleBlocks = modules
        .map((name) => this.domainPackage.promptModules[name])
        .filter((text): text is string => Boolean(text))
        .map((text) => text.trim())
        .filter((text) => text.length > 0);
      systemBlocks = [
        this.domainPackage.systemPromptText,
        ...moduleBlocks,
        `Use this runtime grounding context when relevant. If it conflicts with your assumptions, trust it.\n\n${context.runtimeContext}`,
        reportingIntervalHint
      ];
      const mainResult = await this.invokeModel(
        [
          ...systemBlocks.map((content) => ({ role: "system" as const, content })),
          ...history
        ],
        this.modelInvokeOptions(session, "main_turn")
      );
      calls.push(mainResult.call);
      if (traceTags) {
        Object.assign(traceTags, buildLlmTraceTags(mainResult.call));
      }
      text = mainResult.text;
      debug.push(`main_turn_output=${mainResult.text}`);
    }

    const repaired = await this.repairEngine.repairIfNeeded(
      text,
      {
        runtimeContext: context.runtimeContext,
        userPrompt: effectiveUserText,
        knownMetricStems: context.knownMetricStems,
        intentFlags,
        validatorRules: this.domainPackage.validatorRules,
        domainPackage: this.domainPackage,
        reportingIntervalMinutes: reportingInterval.reportingIntervalMinutes,
        reportingIntervalSeconds: reportingInterval.reportingIntervalSeconds,
        confirmationAck,
        assistantMarkers: confirmationConfig?.assistantMarkers
      },
      systemBlocks,
      history,
      this.modelInvokeOptions(session, "repair")
    );
    text = repaired.text;
    debug.push(...repaired.debug);
    debug.push(`post_repair_output=${text}`);
    calls.push(...repaired.calls);

    if (looksLikeTurtleIntent(text)) {
      text = await traceToolCall("postprocessors_final", { when: "always" }, () =>
        runConfiguredPostprocessors({
          text: extractTurtlePayload(text),
          context: {
            runtimeContext: context.runtimeContext,
            userPrompt: effectiveUserText,
            knownMetricStems: context.knownMetricStems,
            intentFlags,
            validatorRules: this.domainPackage.validatorRules,
            reportingIntervalMinutes: reportingInterval.reportingIntervalMinutes,
            reportingIntervalSeconds: reportingInterval.reportingIntervalSeconds
          },
          domainPackage: this.domainPackage,
          when: "always",
          debug
        })
      );
      debug.push(`post_final_normalize_output=${text}`);
    }

    const shaclResult = await traceToolCall(
      "shacl_validate",
      {
        hadRepairPass: repaired.calls.length > 0,
        shapesFile: this.config.shaclShapesFile,
        maxRetries: this.config.shaclMaxRetries
      },
      async () =>
        this.validateAndRepairWithShacl({
          text,
          warnings,
          debug,
          runtimeContext: context.runtimeContext
        })
    );
    text = shaclResult.text;

    const persistResult = await traceToolCall(
      "graphdb_persist",
      { noGraphDb: process.env.NO_GRAPHDB === "true" },
      () =>
        this.persistGeneratedIntentIfNeeded(
          text,
          warnings,
          debug,
          session,
          confirmationAck,
          shaclResult
        )
    );
    const turtlePresent = looksLikeTurtleIntent(text);
    if (!traceTags) {
      traceTags = {};
    }
    Object.assign(traceTags, {
      "intent.turtle_present": turtlePresent,
      "shacl.conforms": shaclResult.conforms,
      "shacl.attempts": String(shaclResult.attempts),
      "shacl.violation_count": String(shaclResult.violations.length),
      "shacl.report": previewText(shaclResult.reportText),
      "graphdb.persisted": persistResult.persisted,
      "graphdb.intent_id": persistResult.intentId ?? ""
    });
    if (isMlflowTracingEnabled()) {
      updateCurrentTrace({
        requestPreview: previewText(effectiveUserText),
        tags: normalizeStringRecord(traceTags),
        metadata: normalizeStringRecord(traceMetadata ?? {})
      });
    }

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
    return {
      response: text,
      warnings,
      debug,
      intentUsageSummary,
      effectiveUserText,
      turtlePresent,
      confirmationAck,
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

  private modelInvokeOptions(session: ChatSession, stage: string): ModelInvokeOptions {
    return {
      stage,
      llmModel: session.llmModelOverride ?? undefined,
      llmApiBaseUrl: session.llmApiBaseUrlOverride ?? undefined,
      temperature: session.temperatureOverride ?? undefined
    };
  }

  async resolveWorkloadPreview(
    userText: string,
    graphTargetBinding?: import("../models.js").GraphTargetBinding | null
  ) {
    const intentFlags = this.workflowEngine.classifyIntent(userText);
    return this.contextBuilder.resolveWorkloadPreview(userText, intentFlags, graphTargetBinding);
  }

  private async validateAndRepairWithShacl(args: {
    text: string;
    warnings: string[];
    debug: string[];
    runtimeContext: string;
  }): Promise<{
    text: string;
    conforms: boolean;
    attempts: number;
    violations: Array<{ focusNode?: string; path?: string; message: string }>;
    reportText: string;
  }> {
    const emptyViolationResult = {
      violations: [] as Array<{ focusNode?: string; path?: string; message: string }>,
      reportText: ""
    };
    if (!looksLikeTurtleIntent(args.text)) {
      return {
        text: args.text,
        conforms: false,
        attempts: 0,
        ...emptyViolationResult,
        reportText: "SHACL validation skipped: output does not look like Turtle intent."
      };
    }
    if (!this.config.shaclShapesFile) {
      return {
        text: args.text,
        conforms: true,
        attempts: 0,
        ...emptyViolationResult,
        reportText: "SHACL validation skipped (no shapes file configured)."
      };
    }

    let current = this.normalizeTurtleText(args.text);
    let lastResult = {
      conforms: false,
      violations: [] as Array<{ focusNode?: string; path?: string; message: string }>,
      reportText: ""
    };
    for (let attempt = 0; attempt <= this.config.shaclMaxRetries; attempt += 1) {
      lastResult = await this.shaclValidator.validateTurtle(current);
      args.debug.push(
        `shacl_attempt=${attempt + 1} conforms=${lastResult.conforms} violations=${lastResult.violations.length}`
      );
      if (lastResult.violations.length > 0) {
        args.debug.push(`shacl_violations=${JSON.stringify(lastResult.violations)}`);
        args.debug.push(`shacl_report=${lastResult.reportText}`);
      }

      if (lastResult.conforms) {
        args.warnings.push(
          attempt > 0 ? "SHACL validation passed after automatic repair." : "SHACL validation passed."
        );
        return {
          text: current,
          conforms: true,
          attempts: attempt + 1,
          violations: lastResult.violations,
          reportText: lastResult.reportText
        };
      }

      const violationSummary = lastResult.violations
        .map((violation) => violation.message)
        .join("; ");
      args.warnings.push(
        `SHACL validation failed on attempt ${attempt + 1}/${this.config.shaclMaxRetries + 1} (${lastResult.violations.length} violation(s)): ${violationSummary}`
      );

      if (attempt >= this.config.shaclMaxRetries) {
        args.warnings.push("Final intent did not pass SHACL validation after retry attempts.");
        args.debug.push(`shacl_final_report=${lastResult.reportText}`);
        return {
          text: `${current}

# SHACL validation result
# Non-conformant after repair attempts.
# ${lastResult.reportText}`,
          conforms: false,
          attempts: attempt + 1,
          violations: lastResult.violations,
          reportText: lastResult.reportText
        };
      }
      args.debug.push("shacl_repair_attempt_skipped_model_rewrite=true");
    }

    return {
      text: current,
      conforms: false,
      attempts: this.config.shaclMaxRetries + 1,
      violations: lastResult.violations,
      reportText: lastResult.reportText
    };
  }

  private normalizeTurtleText(text: string): string {
    return extractTurtlePayload(text);
  }

  private resolveGraphDbToolPaths(): string[] {
    const cloneToolPath = resolve(process.cwd(), "src", "tools", "graphdbTool.ts");
    const packageToolPath = join(this.domainPackage.packageDir, "tools", "graphdbTool.ts");
    return [cloneToolPath, packageToolPath];
  }

  private async createGraphDbWriterApi(
    graphTargetBinding?: GraphTargetBinding | null
  ): Promise<GraphDbWriterApi> {
    const fallback = {
      graphDbEndpoint: this.config.graphDbEndpoint,
      graphDbNamedGraph: this.config.graphDbNamedGraph,
      graphDbQueryLimit: this.config.graphDbQueryLimit
    };
    for (const candidate of this.resolveGraphDbToolPaths()) {
      if (!existsSync(candidate)) continue;
      const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
      const ToolCtor = mod.GraphDbTool as
        | (new (
            endpoint: string,
            namedGraph: string,
            queryLimit: number,
            repositoryBaseUrl?: string
          ) => GraphDbWriterApi)
        | undefined;
      if (!ToolCtor) continue;
      const fromBinding = ToolCtor as typeof ToolCtor & {
        fromBinding?: (
          binding: GraphTargetBinding | null | undefined,
          env: typeof fallback,
          queryLimit?: number
        ) => GraphDbWriterApi;
      };
      if (typeof fromBinding.fromBinding === "function") {
        return fromBinding.fromBinding(graphTargetBinding, fallback);
      }
      return new ToolCtor(
        fallback.graphDbEndpoint,
        graphTargetBinding?.graphIri ?? "",
        fallback.graphDbQueryLimit,
        graphTargetBinding?.repositoryBaseUrl
      );
    }
    throw new Error("graphdbTool.ts does not export GraphDbTool.");
  }

  private async persistGeneratedIntentIfNeeded(
    text: string,
    warnings: string[],
    debug: string[],
    session: ChatSession,
    confirmationAck: boolean,
    shaclResult: { conforms: boolean }
  ): Promise<{ persisted: boolean; intentId: string | null; skipped: boolean }> {
    const eligibility = graphDbPersistEligibility({
      text,
      confirmationAck,
      shaclConforms: shaclResult.conforms,
      noGraphDb: process.env.NO_GRAPHDB === "true"
    });
    if (!eligibility.eligible) {
      if (eligibility.skipReason) {
        debug.push(`graphdb_persist_skipped=${eligibility.skipReason}`);
      }
      return {
        persisted: false,
        intentId: looksLikeTurtleIntent(text) ? extractIntentIdFromTurtle(text) : null,
        skipped: true
      };
    }
    const turtle = this.normalizeTurtleText(text);
    const intentId = extractIntentIdFromTurtle(turtle);
    const persistTarget = resolvePersistGraphTargetBinding(session.graphTargetBinding);
    if (persistTarget) {
      debug.push(
        `graphdb_persist_target=${persistTarget.repositoryId}|${persistTarget.graphIri}`
      );
    }
    try {
      const graphDbWriter = await this.createGraphDbWriterApi(persistTarget);
      const stored = await graphDbWriter.insertTurtle(turtle);
      if (!stored) {
        warnings.push("Generated intent could not be persisted to GraphDB.");
        debug.push("graphdb_persist_ok=false");
        return { persisted: false, intentId, skipped: false };
      }
      debug.push("graphdb_persist_ok=true");
      return { persisted: true, intentId, skipped: false };
    } catch (error) {
      warnings.push("Generated intent persistence to GraphDB failed.");
      debug.push(`graphdb_persist_error=${String(error)}`);
      return { persisted: false, intentId, skipped: false };
    }
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

function extractIntentIdFromTurtle(turtle: string): string | null {
  const match = turtle.match(/\bdata5g:(I[0-9a-fA-F]{32})\b/);
  return match?.[1] ?? null;
}

export function graphDbPersistEligibility(args: {
  text: string;
  confirmationAck: boolean;
  shaclConforms: boolean;
  noGraphDb: boolean;
}): { eligible: boolean; skipReason?: string } {
  if (!looksLikeTurtleIntent(args.text)) {
    return { eligible: false, skipReason: "not_turtle_intent" };
  }
  if (args.noGraphDb) {
    return { eligible: false, skipReason: "no_graphdb" };
  }
  if (!args.confirmationAck) {
    return { eligible: false, skipReason: "not_synthesis_turn" };
  }
  if (!args.shaclConforms) {
    return { eligible: false, skipReason: "shacl_nonconformant" };
  }
  if (args.text.includes("# SHACL validation result")) {
    return { eligible: false, skipReason: "shacl_nonconformant" };
  }
  return { eligible: true };
}

function buildReportingIntervalHint(interval: ReportingIntervalForPostprocessor): string {
  const intervalLine =
    interval.reportingIntervalSeconds !== undefined
      ? `- Reporting interval: ${interval.reportingIntervalSeconds} second(s) (time:unitSecond).`
      : `- Reporting interval: ${interval.reportingIntervalMinutes ?? 10} minute(s) (time:unitMinute).`;
  return [
    "Observation reporting policy for this session:",
    intervalLine,
    "- Use per-reporting-expectation event class URIs (e.g. SixtySecondReportEventDeployment_CO<condition-id>), never global TenMinuteReportEventDeployment / tenMinutesDeployment shared across intents.",
    "- Each event class must have exactly one imo:eventFor to its DE, SE, or NE expectation.",
    "- Use paired duration locals durationDeployment_<anchor> (or Sustainability/Network) with matching time:numericDuration and unitType."
  ].join("\n");
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
