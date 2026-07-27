import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "../config.js";
import {
  clampReportingIntervalMinutes,
  clampReportingIntervalSeconds
} from "../config.js";
import type {
  AgentTurnResult,
  ChatSession,
  GraphTargetBinding,
  ModelInvocationResult,
  ModelInvokeOptions
} from "../models.js";
import {
  isConfirmationText,
  assistantRequestedConfirmation,
  lastSubstantiveUserRequest
} from "../core/confirmationState.js";
import { FragmentGenerationEngine } from "../core/fragmentGenerationEngine.js";
import {
  extractTurtlePayload,
  looksLikeTurtleIntent
} from "../core/outputPolicyValidator.js";
import type { LoadedDomainPackage } from "../core/packageLoader.js";
import { runConfiguredPostprocessors } from "../core/postprocessorRunner.js";
import { RepairEngine } from "../core/repairEngine.js";
import { tryReplPackageHook } from "../core/replPackageHook.js";
import { RuntimeContextBuilder } from "../core/runtimeContextBuilder.js";
import { ShaclValidatorTool } from "../core/shaclValidatorTool.js";
import { buildIntentUsageSummary } from "../core/usage.js";
import { appendUsageLog } from "../core/usageLogger.js";
import {
  adjustModulesForConfirmationAck,
  WorkflowEngine
} from "../core/workflowEngine.js";
import { resolvePersistGraphTargetBinding } from "../core/graphTargetBinding.js";
import {
  buildLlmTraceTags,
  isLangSmithTracingEnabled,
  isMlflowTracingEnabled,
  normalizeStringRecord,
  previewText,
  traceToolCall,
  updateCurrentTrace
} from "../tracing/langsmith.js";
import type { TurnGraphHandlers } from "./buildTurnGraph.js";
import type { AgentTurnState, PersistNodeResult, ShaclNodeResult } from "./state.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
type GraphDbWriterApi = { insertTurtle: (turtle: string) => Promise<boolean> };

export type TurnHandlerDeps = {
  config: AppConfig;
  domainPackage: LoadedDomainPackage;
  invokeModel: (
    messages: ModelMessage[],
    options?: ModelInvokeOptions
  ) => Promise<ModelInvocationResult>;
  contextBuilder?: RuntimeContextBuilder;
  shaclValidator?: ShaclValidatorTool;
  repairEngine?: RepairEngine;
  workflowEngine?: WorkflowEngine;
  fragmentGenerationEngine?: FragmentGenerationEngine;
};

export function createTurnHandlers(deps: TurnHandlerDeps): TurnGraphHandlers {
  const contextBuilder =
    deps.contextBuilder ?? new RuntimeContextBuilder(deps.config, deps.domainPackage);
  const shaclValidator = deps.shaclValidator ?? new ShaclValidatorTool(deps.config.shaclShapesFile);
  const repairEngine = deps.repairEngine ?? new RepairEngine(deps.invokeModel);
  const workflowEngine = deps.workflowEngine ?? new WorkflowEngine(deps.domainPackage);
  const fragmentGenerationEngine =
    deps.fragmentGenerationEngine ?? new FragmentGenerationEngine();

  const modelInvokeOptions = (session: ChatSession, stage: string): ModelInvokeOptions => ({
    stage,
    llmModel: session.llmModelOverride ?? undefined,
    llmApiBaseUrl: session.llmApiBaseUrlOverride ?? undefined,
    temperature: session.temperatureOverride ?? undefined
  });

  const handlers: TurnGraphHandlers = {
    async replHook(state) {
      const result = await tryReplPackageHook({
        line: state.userText.trim(),
        session: state.session,
        domainPackage: deps.domainPackage,
        debug: state.hooks?.replHookDebug ?? false,
        debugLogPath: state.hooks?.replHookDebugLogPath ?? "logs/simulator-agent-debug.jsonl",
        graphDbEndpoint: deps.config.graphDbEndpoint,
        graphDbNamedGraph: deps.config.graphDbNamedGraph,
        graphDbQueryLimit: deps.config.graphDbQueryLimit,
        graphTargetBinding: state.session.graphTargetBinding ?? null,
        observationStorageOverride: state.session.observationStorage ?? null,
        createIntentStorage: state.session.createIntentStorage ?? null
      });
      if (!result.handled) return { replHandled: false };
      if (isMlflowTracingEnabled()) updateCurrentTrace({ tags: { "turn.path": "repl_package_hook" } });
      state.session.messages.push({
        role: "user",
        text: state.userText,
        createdAt: new Date().toISOString()
      });
      if (result.assistantText) {
        state.session.messages.push({
          role: "assistant",
          text: result.assistantText,
          createdAt: new Date().toISOString()
        });
      }
      return {
        replHandled: true,
        assistantText: result.assistantText ?? "",
        debug: ["repl_package_hook_handled=true"]
      };
    },

    async confirm(state) {
      const confirmation = deps.domainPackage.workflow.confirmation;
      const acceptedInputs = confirmation?.acceptedUserInputs ?? ["ok"];
      const confirmationAck =
        isConfirmationText(state.userText, acceptedInputs) &&
        assistantRequestedConfirmation(
          state.session,
          confirmation?.assistantMarkers ?? ["type ok to confirm"]
        );
      const previousRequest = lastSubstantiveUserRequest(state.session, acceptedInputs);
      return {
        confirmationAck,
        effectiveUserText:
          confirmationAck && previousRequest ? previousRequest : state.userText
      };
    },

    async classify(state) {
      return { intentFlags: workflowEngine.classifyIntent(state.effectiveUserText) };
    },

    async context(state) {
      const context = await contextBuilder.build(
        state.effectiveUserText,
        state.intentFlags,
        state.session.graphTargetBinding ?? null
      );
      const selectedChart = state.debug
        .concat(context.debug)
        .find((line) => line.startsWith("selected_workload_chart="))
        ?.split("=")[1] ?? "";
      const traceTags = isLangSmithTracingEnabled()
        ? normalizeStringRecord({
            "turn.path": "llm_turn",
            "turn.confirmation_ack": state.confirmationAck,
            "intent.effective_user_text": state.effectiveUserText,
            "intent.flags.deployment": state.intentFlags.deployment,
            "intent.flags.locality": state.intentFlags.locality,
            "intent.flags.networkQos": state.intentFlags.networkQos,
            "intent.flags.sustainability": state.intentFlags.sustainability ?? false,
            "intent.flags.coordination": state.intentFlags.coordination ?? false,
            "intent.flags.observationReport": state.intentFlags.observationReport ?? false,
            "context.selected_chart": selectedChart,
            "session.observation_storage": state.session.observationStorage ?? "",
            "session.create_intent_storage": state.session.createIntentStorage ?? ""
          })
        : {};
      const traceMetadata: Record<string, string> = isLangSmithTracingEnabled()
        ? { runtime_context_preview: previewText(context.runtimeContext, 500) }
        : {};
      return {
        runtimeContext: context.runtimeContext,
        knownMetricStems: context.knownMetricStems,
        warnings: context.warnings,
        debug: [...context.debug, `confirmation_acknowledged=${state.confirmationAck}`],
        traceTags,
        traceMetadata
      };
    },

    async prompt(state) {
      state.session.messages.push({
        role: "user",
        text: state.userText,
        createdAt: new Date().toISOString()
      });
      const reportingInterval = resolveReportingInterval(state.session, deps.config.intentReportIntervalMinutes);
      const reportingIntervalHint = buildReportingIntervalHint(reportingInterval);
      const useFragmented =
        state.confirmationAck && deps.domainPackage.workflow.generation?.mode === "fragmented";
      if (useFragmented) {
        return {
          generationMode: "fragmented",
          systemBlocks: [deps.domainPackage.systemPromptText, reportingIntervalHint]
        };
      }
      state.session.intentDraft = undefined;
      const modules = adjustModulesForConfirmationAck(
        workflowEngine.modulesForTurn(state.intentFlags, "default"),
        state.confirmationAck
      );
      const moduleBlocks = modules
        .map((name) => deps.domainPackage.promptModules[name])
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean);
      const blocks = [
        deps.domainPackage.systemPromptText,
        ...moduleBlocks,
        `Use this runtime grounding context when relevant. If it conflicts with your assumptions, trust it.\n\n${state.runtimeContext}`,
        reportingIntervalHint
      ];
      if (state.confirmationAck) {
        blocks.push(
          deps.domainPackage.workflow.confirmation?.forceGenerateInstruction ??
            "The user has explicitly confirmed. Do not ask for confirmation again. Generate the final Turtle intent now."
        );
      }
      return { generationMode: "single", modules, systemBlocks: blocks };
    },

    async generate(state) {
      const reportingInterval = resolveReportingInterval(state.session, deps.config.intentReportIntervalMinutes);
      if (state.generationMode === "fragmented") {
        const debug: string[] = [];
        const generated = await fragmentGenerationEngine.generate({
          session: state.session,
          domainPackage: deps.domainPackage,
          intentFlags: state.intentFlags,
          effectiveUserText: state.effectiveUserText,
          runtimeContext: state.runtimeContext,
          reportingIntervalHint: buildReportingIntervalHint(reportingInterval),
          invokeModel: deps.invokeModel,
          modelInvokeOptions: (stage) => modelInvokeOptions(state.session, stage),
          debug
        });
        const lastCall = generated.calls.at(-1);
        return {
          assistantText: generated.text,
          intentDraft: generated.draft,
          calls: generated.calls,
          systemBlocks: [
            deps.domainPackage.systemPromptText,
            `Fragmented generation: ${generated.fragmentIds.join(", ")}`
          ],
          debug: [...debug, `fragmented_generation_output_chars=${generated.assembledChars}`],
          traceTags: normalizeStringRecord({
            "generation.mode": "fragmented",
            "generation.fragment_count": generated.fragmentIds.length,
            "generation.fragment_ids": generated.fragmentIds.join(","),
            "generation.assembled_chars": generated.assembledChars,
            ...(lastCall ? buildLlmTraceTags(lastCall) : {})
          })
        };
      }
      const history = toHistory(state);
      const result = await deps.invokeModel(
        [
          ...state.systemBlocks.map((content) => ({ role: "system" as const, content })),
          ...history
        ],
        modelInvokeOptions(state.session, "main_turn")
      );
      return {
        assistantText: result.text,
        calls: [result.call],
        debug: [`main_turn_output=${result.text}`],
        traceTags: { "generation.mode": "single", ...buildLlmTraceTags(result.call) }
      };
    },

    async repair(state) {
      const reportingInterval = resolveReportingInterval(state.session, deps.config.intentReportIntervalMinutes);
      const repaired = await repairEngine.repairIfNeeded(
        state.assistantText,
        {
          runtimeContext: state.runtimeContext,
          userPrompt: state.effectiveUserText,
          knownMetricStems: state.knownMetricStems,
          intentFlags: state.intentFlags,
          validatorRules: deps.domainPackage.validatorRules,
          domainPackage: deps.domainPackage,
          reportingIntervalMinutes: reportingInterval.reportingIntervalMinutes,
          reportingIntervalSeconds: reportingInterval.reportingIntervalSeconds,
          confirmationAck: state.confirmationAck,
          assistantMarkers: deps.domainPackage.workflow.confirmation?.assistantMarkers
        },
        state.systemBlocks,
        toHistory(state),
        modelInvokeOptions(state.session, "repair")
      );
      return {
        assistantText: repaired.text,
        calls: repaired.calls,
        debug: [...repaired.debug, `post_repair_output=${repaired.text}`]
      };
    },

    async postprocess(state) {
      if (!looksLikeTurtleIntent(state.assistantText)) return {};
      const reportingInterval = resolveReportingInterval(state.session, deps.config.intentReportIntervalMinutes);
      const debug: string[] = [];
      const text = await traceToolCall("postprocessors_final", { when: "always" }, () =>
        runConfiguredPostprocessors({
          text: extractTurtlePayload(state.assistantText),
          context: {
            runtimeContext: state.runtimeContext,
            userPrompt: state.effectiveUserText,
            knownMetricStems: state.knownMetricStems,
            intentFlags: state.intentFlags,
            validatorRules: deps.domainPackage.validatorRules,
            reportingIntervalMinutes: reportingInterval.reportingIntervalMinutes,
            reportingIntervalSeconds: reportingInterval.reportingIntervalSeconds
          },
          domainPackage: deps.domainPackage,
          when: "always",
          debug
        })
      );
      return { assistantText: text, debug: [...debug, `post_final_normalize_output=${text}`] };
    },

    async shacl(state) {
      const result = await traceToolCall(
        "shacl_validate",
        {
          hadRepairPass: state.calls.some((call) => call.stage.startsWith("repair")),
          shapesFile: deps.config.shaclShapesFile,
          maxRetries: deps.config.shaclMaxRetries
        },
        () => validateAndRepairWithShacl(deps.config, shaclValidator, state.assistantText)
      );
      return { assistantText: result.text, shacl: result, warnings: result.warnings, debug: result.debug };
    },

    async persist(state) {
      const result = await traceToolCall(
        "graphdb_persist",
        { noGraphDb: process.env.NO_GRAPHDB === "true" },
        () =>
          persistGeneratedIntentIfNeeded(
            deps.config,
            deps.domainPackage,
            state.assistantText,
            state.session,
            state.confirmationAck,
            state.shacl?.conforms ?? false
          )
      );
      return { persist: result.result, warnings: result.warnings, debug: result.debug };
    },

    async finalize(state) {
      const turtlePresent = looksLikeTurtleIntent(state.assistantText);
      const traceTags = normalizeStringRecord({
        ...state.traceTags,
        "intent.turtle_present": turtlePresent,
        "shacl.conforms": state.shacl?.conforms ?? false,
        "shacl.attempts": state.shacl?.attempts ?? 0,
        "shacl.violation_count": state.shacl?.violations.length ?? 0,
        "shacl.report": previewText(state.shacl?.reportText ?? ""),
        "graphdb.persisted": state.persist?.persisted ?? false,
        "graphdb.intent_id": state.persist?.intentId ?? ""
      });
      if (isLangSmithTracingEnabled()) {
        updateCurrentTrace({
          requestPreview: previewText(state.effectiveUserText || state.userText),
          tags: traceTags,
          metadata: normalizeStringRecord(state.traceMetadata)
        });
      }
      if (!state.replHandled) {
        state.session.messages.push({
          role: "assistant",
          text: state.assistantText,
          createdAt: new Date().toISOString()
        });
      }
      const intentUsageSummary = buildIntentUsageSummary(state.calls);
      if (intentUsageSummary && deps.config.llmUsageLogPath) {
        appendUsageLog(deps.config.llmUsageLogPath, {
          timestampUtc: new Date().toISOString(),
          sessionId: state.session.sessionId,
          turnId: state.turnId,
          usage: intentUsageSummary
        });
      }
      const debug = [
        ...state.debug,
        `session_messages_after_assistant=${state.session.messages.length}`,
        `turn_id=${state.turnId}`
      ];
      const turnResult: AgentTurnResult = {
        response: state.assistantText,
        warnings: state.warnings,
        debug,
        intentUsageSummary,
        turnId: state.turnId,
        effectiveUserText: state.effectiveUserText || undefined,
        turtlePresent,
        confirmationAck: state.confirmationAck,
        traceTags,
        traceMetadata: normalizeStringRecord(state.traceMetadata)
      };
      return { debug, traceTags, turnResult };
    }
  };
  return handlers;
}

function toHistory(
  state: AgentTurnState
): Array<{ role: "user" | "assistant"; content: string }> {
  return state.session.messages.map((message) => ({
    role: message.role,
    content: message.text
  }));
}

type ReportingInterval = { reportingIntervalMinutes?: number; reportingIntervalSeconds?: number };

function resolveReportingInterval(session: ChatSession, envDefaultMinutes: number): ReportingInterval {
  if (session.reportingIntervalSecondsOverride != null) {
    return {
      reportingIntervalSeconds: clampReportingIntervalSeconds(session.reportingIntervalSecondsOverride)
    };
  }
  return {
    reportingIntervalMinutes: clampReportingIntervalMinutes(
      session.reportingIntervalMinutesOverride ?? envDefaultMinutes
    )
  };
}

function buildReportingIntervalHint(interval: ReportingInterval): string {
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

async function validateAndRepairWithShacl(
  config: AppConfig,
  validator: ShaclValidatorTool,
  text: string
): Promise<ShaclNodeResult & { warnings: string[]; debug: string[] }> {
  const warnings: string[] = [];
  const debug: string[] = [];
  if (!looksLikeTurtleIntent(text)) {
    return {
      text,
      conforms: false,
      attempts: 0,
      violations: [],
      reportText: "SHACL validation skipped: output does not look like Turtle intent.",
      warnings,
      debug
    };
  }
  if (!config.shaclShapesFile) {
    return {
      text,
      conforms: true,
      attempts: 0,
      violations: [],
      reportText: "SHACL validation skipped (no shapes file configured).",
      warnings,
      debug
    };
  }
  let current = extractTurtlePayload(text);
  let lastResult = { conforms: false, violations: [] as Array<{ focusNode?: string; path?: string; message: string }>, reportText: "" };
  for (let attempt = 0; attempt <= config.shaclMaxRetries; attempt += 1) {
    lastResult = await validator.validateTurtle(current);
    debug.push(`shacl_attempt=${attempt + 1} conforms=${lastResult.conforms} violations=${lastResult.violations.length}`);
    if (lastResult.violations.length > 0) {
      debug.push(`shacl_violations=${JSON.stringify(lastResult.violations)}`, `shacl_report=${lastResult.reportText}`);
    }
    if (lastResult.conforms) {
      warnings.push(attempt > 0 ? "SHACL validation passed after automatic repair." : "SHACL validation passed.");
      return { text: current, attempts: attempt + 1, ...lastResult, warnings, debug };
    }
    const summary = lastResult.violations.map((violation) => violation.message).join("; ");
    warnings.push(`SHACL validation failed on attempt ${attempt + 1}/${config.shaclMaxRetries + 1} (${lastResult.violations.length} violation(s)): ${summary}`);
    if (attempt >= config.shaclMaxRetries) {
      warnings.push("Final intent did not pass SHACL validation after retry attempts.");
      debug.push(`shacl_final_report=${lastResult.reportText}`);
      return {
        text: `${current}\n\n# SHACL validation result\n# Non-conformant after repair attempts.\n# ${lastResult.reportText}`,
        attempts: attempt + 1,
        ...lastResult,
        warnings,
        debug
      };
    }
    debug.push("shacl_repair_attempt_skipped_model_rewrite=true");
  }
  return { text: current, attempts: config.shaclMaxRetries + 1, ...lastResult, warnings, debug };
}

async function persistGeneratedIntentIfNeeded(
  config: AppConfig,
  domainPackage: LoadedDomainPackage,
  text: string,
  session: ChatSession,
  confirmationAck: boolean,
  shaclConforms: boolean
): Promise<{ result: PersistNodeResult; warnings: string[]; debug: string[] }> {
  const warnings: string[] = [];
  const debug: string[] = [];
  const fragmented = domainPackage.workflow.generation?.mode === "fragmented";
  if (fragmented) {
    const eligibility = graphDbPersistEligibility({
      text,
      confirmationAck,
      shaclConforms,
      noGraphDb: process.env.NO_GRAPHDB === "true"
    });
    if (!eligibility.eligible) {
      if (eligibility.skipReason) debug.push(`graphdb_persist_skipped=${eligibility.skipReason}`);
      return { result: { persisted: false, intentId: looksLikeTurtleIntent(text) ? extractIntentId(text) : null, skipped: true }, warnings, debug };
    }
  } else if (!looksLikeTurtleIntent(text) || process.env.NO_GRAPHDB === "true") {
    if (process.env.NO_GRAPHDB === "true") debug.push("graphdb_persist_skipped=no_graphdb");
    return { result: { persisted: false, intentId: looksLikeTurtleIntent(text) ? extractIntentId(text) : null, skipped: true }, warnings, debug };
  }
  const turtle = extractTurtlePayload(text);
  const intentId = extractIntentId(turtle);
  const target = resolvePersistGraphTargetBinding(session.graphTargetBinding);
  if (target) debug.push(`graphdb_persist_target=${target.repositoryId}|${target.graphIri}`);
  try {
    const stored = await createGraphDbWriterApi(config, domainPackage, target);
    if (!(await stored.insertTurtle(turtle))) {
      warnings.push("Generated intent could not be persisted to GraphDB.");
      debug.push("graphdb_persist_ok=false");
      return { result: { persisted: false, intentId, skipped: false }, warnings, debug };
    }
    debug.push("graphdb_persist_ok=true");
    return { result: { persisted: true, intentId, skipped: false }, warnings, debug };
  } catch (error) {
    warnings.push("Generated intent persistence to GraphDB failed.");
    debug.push(`graphdb_persist_error=${String(error)}`);
    return { result: { persisted: false, intentId, skipped: false }, warnings, debug };
  }
}

async function createGraphDbWriterApi(
  config: AppConfig,
  domainPackage: LoadedDomainPackage,
  binding?: GraphTargetBinding | null
): Promise<GraphDbWriterApi> {
  const fallback = {
    graphDbEndpoint: config.graphDbEndpoint,
    graphDbNamedGraph: config.graphDbNamedGraph,
    graphDbQueryLimit: config.graphDbQueryLimit
  };
  for (const candidate of [
    resolve(process.cwd(), "src", "tools", "graphdbTool.ts"),
    join(domainPackage.packageDir, "tools", "graphdbTool.ts")
  ]) {
    if (!existsSync(candidate)) continue;
    const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>;
    const ToolCtor = mod.GraphDbTool as (new (endpoint: string, namedGraph: string, queryLimit: number, repositoryBaseUrl?: string) => GraphDbWriterApi) & {
      fromBinding?: (binding: GraphTargetBinding | null | undefined, env: typeof fallback, queryLimit?: number) => GraphDbWriterApi;
    };
    if (!ToolCtor) continue;
    if (typeof ToolCtor.fromBinding === "function") return ToolCtor.fromBinding(binding, fallback);
    return new ToolCtor(fallback.graphDbEndpoint, binding?.graphIri ?? "", fallback.graphDbQueryLimit, binding?.repositoryBaseUrl);
  }
  throw new Error("graphdbTool.ts does not export GraphDbTool.");
}

function extractIntentId(turtle: string): string | null {
  return turtle.match(/\bdata5g:(I[0-9a-fA-F]{32})\b/)?.[1] ?? null;
}

function graphDbPersistEligibility(args: {
  text: string;
  confirmationAck: boolean;
  shaclConforms: boolean;
  noGraphDb: boolean;
}): { eligible: boolean; skipReason?: string } {
  if (!looksLikeTurtleIntent(args.text)) return { eligible: false, skipReason: "not_turtle_intent" };
  if (args.noGraphDb) return { eligible: false, skipReason: "no_graphdb" };
  if (!args.confirmationAck) return { eligible: false, skipReason: "not_synthesis_turn" };
  if (!args.shaclConforms || args.text.includes("# SHACL validation result")) {
    return { eligible: false, skipReason: "shacl_nonconformant" };
  }
  return { eligible: true };
}
