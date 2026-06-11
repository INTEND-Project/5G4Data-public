import "./mlflowProviderPatch.js";
import { setTrackingStoreExportEnabled } from "./mlflowProviderPatch.js";
import { flushCompositeTraces } from "./mlflowCompositeProvider.js";
import {
  SpanAttributeKey,
  SpanStatusCode,
  SpanType,
  TokenUsageKey,
  getLastActiveTraceId,
  init,
  updateCurrentTrace,
  withSpan
} from "mlflow-tracing";
import type { AppConfig } from "../config.js";
import type { LlmCallRecord, ModelInvocationResult, ModelInvokeOptions } from "../models.js";
import { resolveMlflowExperimentId } from "./experimentResolver.js";

export interface AgentTraceIdentity {
  agentName: string;
  packageName: string;
  packageVersion: string;
  apiPort: number;
}

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
type ModelInvoker = (
  messages: ModelMessage[],
  options?: ModelInvokeOptions
) => Promise<ModelInvocationResult>;

/** MLflow stores trace previews and metadata values in varchar(1000) columns. */
export const MLFLOW_TRACE_FIELD_MAX = 1000;
const PREVIEW_MAX = MLFLOW_TRACE_FIELD_MAX;
const SYSTEM_MESSAGE_PREVIEW_MAX = 2000;

let tracingReady = false;
let tracingEnabled = false;
let tracingConfig: AppConfig | null = null;
let activeExperimentId: string | null = null;
let agentIdentity: AgentTraceIdentity | null = null;

export function isMlflowTracingEnabled(): boolean {
  return tracingReady && tracingEnabled;
}

export function previewText(value: string, max = PREVIEW_MAX): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return trimmed.slice(0, max);
  return `${trimmed.slice(0, max - 1)}…`;
}

export interface TurnTraceJudgeFields {
  effectiveUserText?: string;
  turtlePresent?: boolean;
  confirmationAck?: boolean;
}

/** Canonical root-span outputs for MLflow online judges ({{ outputs }}). */
export interface JudgeTraceOutputs {
  requirementText: string;
  generatedResponse: string;
  turtlePresent: boolean;
  confirmationAck: boolean;
  warnings: string[];
}

export function buildJudgeTraceInputs(args: {
  effectiveUserText?: string;
  userText: string;
}): string {
  return (args.effectiveUserText ?? args.userText).trim();
}

export function buildJudgeTraceOutputs(args: {
  requirementText: string;
  generatedResponse: string;
  turtlePresent: boolean;
  confirmationAck: boolean;
  warnings: string[];
}): JudgeTraceOutputs {
  return {
    requirementText: args.requirementText,
    generatedResponse: args.generatedResponse,
    turtlePresent: args.turtlePresent,
    confirmationAck: args.confirmationAck,
    warnings: args.warnings
  };
}

/** Merge trace tag records and normalize for MLflow varchar limits. */
export function mergeTraceTagRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, string> {
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    if (!record) continue;
    Object.assign(merged, record);
  }
  return normalizeStringRecord(merged);
}

/** @internal Exported for tests. Reads judge-oriented fields from a turn result. */
export function readTurnTraceJudgeFields(result: unknown): TurnTraceJudgeFields {
  if (typeof result !== "object" || result === null) return {};
  const record = result as Record<string, unknown>;
  const fields: TurnTraceJudgeFields = {};
  if (typeof record.effectiveUserText === "string") {
    fields.effectiveUserText = record.effectiveUserText;
  }
  if (typeof record.turtlePresent === "boolean") {
    fields.turtlePresent = record.turtlePresent;
  }
  if (typeof record.confirmationAck === "boolean") {
    fields.confirmationAck = record.confirmationAck;
  }
  return fields;
}

function readTurnTraceExport(result: unknown): {
  judgeFields: TurnTraceJudgeFields;
  traceTags?: Record<string, string>;
  traceMetadata?: Record<string, string>;
} {
  if (typeof result !== "object" || result === null) {
    return { judgeFields: {} };
  }
  const record = result as Record<string, unknown>;
  const traceTags =
    record.traceTags && typeof record.traceTags === "object"
      ? (record.traceTags as Record<string, string>)
      : undefined;
  const traceMetadata =
    record.traceMetadata && typeof record.traceMetadata === "object"
      ? (record.traceMetadata as Record<string, string>)
      : undefined;
  return {
    judgeFields: readTurnTraceJudgeFields(result),
    traceTags,
    traceMetadata
  };
}

export function summarizeMessagesForTrace(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "system") return message;
    return {
      role: message.role,
      content: previewText(message.content, SYSTEM_MESSAGE_PREVIEW_MAX)
    };
  });
}

function baseTraceTags(identity: AgentTraceIdentity): Record<string, string> {
  return {
    "agent.name": identity.agentName,
    "package.name": identity.packageName,
    "package.version": identity.packageVersion,
    "api.port": String(identity.apiPort)
  };
}

function baseTraceMetadata(
  identity: AgentTraceIdentity,
  sessionId: string,
  turnId: string
): Record<string, string> {
  return {
    ...baseTraceTags(identity),
    "mlflow.trace.session": sessionId,
    "turn.id": turnId
  };
}

/** MLflow trace_metadata values must be strings (not nested objects). */
export function normalizeStringRecord(
  record: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    const asString =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
    out[key] =
      asString.length <= MLFLOW_TRACE_FIELD_MAX
        ? asString
        : previewText(asString, MLFLOW_TRACE_FIELD_MAX);
  }
  return out;
}

/** Span attributes MLflow uses for cost breakdown / cost-over-time charts. */
export const MLFLOW_LLM_MODEL_ATTR = "mlflow.llm.model";
export const MLFLOW_LLM_PROVIDER_ATTR = "mlflow.llm.provider";

/** @internal Exported for tests and package bridges. */
export function buildLlmSpanAttributes(call: LlmCallRecord): Record<string, string | number | boolean> {
  return {
    [MLFLOW_LLM_MODEL_ATTR]: call.model,
    [MLFLOW_LLM_PROVIDER_ATTR]: call.provider,
    "llm.model": call.model,
    "llm.provider": call.provider,
    "llm.stage": call.stage,
    "llm.request_id": call.requestId ?? "",
    "llm.latency_ms": call.latencyMs,
    "llm.usage_known": call.usageKnown
  };
}

export function getActiveMlflowTraceId(): string | null {
  if (!isMlflowTracingEnabled()) return null;
  return getLastActiveTraceId() ?? null;
}

function attachTurnTraceCorrelation<T>(
  result: T,
  turnId: string,
  mlflowTraceId: string | null
): T {
  if (
    !mlflowTraceId ||
    typeof result !== "object" ||
    result === null ||
    !("response" in result)
  ) {
    return result;
  }
  return {
    ...result,
    turnId,
    mlflowTraceId
  };
}

function setLlmTokenUsage(
  span: { setAttribute: (key: string, value: unknown) => void },
  usage: LlmCallRecord["usage"]
): void {
  span.setAttribute(SpanAttributeKey.TOKEN_USAGE, {
    [TokenUsageKey.INPUT_TOKENS]: usage.inputTokens,
    [TokenUsageKey.OUTPUT_TOKENS]: usage.outputTokens,
    [TokenUsageKey.TOTAL_TOKENS]: usage.totalTokens
  });
}

async function bindMlflowExperiment(
  config: AppConfig,
  identity: AgentTraceIdentity,
  reason: "startup" | "turn"
): Promise<boolean> {
  const experimentName = config.mlflowExperimentName ?? identity.agentName;
  const experimentId = await resolveMlflowExperimentId({
    trackingUri: config.mlflowTrackingUri!,
    experimentId: config.mlflowExperimentId,
    experimentName
  });

  if (experimentId !== activeExperimentId) {
    setTrackingStoreExportEnabled(config.mlflowTrackingStoreExportEnabled);
    init({
      trackingUri: config.mlflowTrackingUri!,
      experimentId
    });
    activeExperimentId = experimentId;
    const verb = reason === "startup" ? "tracing enabled" : "tracing rebound";
    process.stdout.write(
      `[MLflow] ${verb} for ${identity.agentName} → experiment ${experimentId} (${experimentName})\n`
    );
  }

  tracingEnabled = true;
  return true;
}

async function ensureMlflowTracingReady(): Promise<boolean> {
  if (!tracingReady || !tracingConfig || !agentIdentity) {
    return false;
  }
  if (!tracingConfig.mlflowTracingEnabled || !tracingConfig.mlflowTrackingUri) {
    return false;
  }

  try {
    return await bindMlflowExperiment(tracingConfig, agentIdentity, "turn");
  } catch (error) {
    tracingEnabled = false;
    process.stderr.write(
      `[MLflow] tracing unavailable: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return false;
  }
}

export async function initializeMlflowTracing(
  config: AppConfig,
  identity: AgentTraceIdentity
): Promise<void> {
  tracingReady = true;
  tracingEnabled = false;
  tracingConfig = config;
  activeExperimentId = null;
  agentIdentity = identity;

  if (!config.mlflowTracingEnabled || !config.mlflowTrackingUri) {
    return;
  }

  try {
    await bindMlflowExperiment(config, identity, "startup");
  } catch (error) {
    process.stderr.write(
      `[MLflow] tracing disabled: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

export async function shutdownMlflowTracing(): Promise<void> {
  if (!tracingEnabled) return;
  await flushCompositeTraces();
}

export function wrapTracedModelInvoker(invokeModel: ModelInvoker): ModelInvoker {
  return async (messages, options = { stage: "main_turn" }) => {
    if (!isMlflowTracingEnabled()) {
      return invokeModel(messages, options);
    }

    const stage = options.stage ?? "main_turn";
    return withSpan(
      async (span) => {
        span.setSpanType(SpanType.LLM);
        span.setInputs({
          stage,
          provider: options.llmModel ? "override" : "configured",
          model: options.llmModel ?? undefined,
          temperature: options.temperature ?? undefined,
          messages: summarizeMessagesForTrace(messages)
        });
        const result = await invokeModel(messages, options);
        setLlmTokenUsage(span, result.call.usage);
        span.setAttributes(buildLlmSpanAttributes(result.call));
        span.end({
          outputs: {
            text: result.text,
            usage: result.call.usage
          }
        });
        return result;
      },
      { name: `llm_${stage}`, spanType: SpanType.LLM }
    );
  };
}

export async function traceToolCall<T>(
  toolName: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  if (!isMlflowTracingEnabled()) {
    return fn();
  }

  return withSpan(
    async (span) => {
      span.setSpanType(SpanType.TOOL);
      span.setInputs(inputs);
      try {
        const result = await fn();
        span.end({ outputs: { result } });
        return result;
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.end({ status: SpanStatusCode.ERROR });
        throw error;
      }
    },
    { name: toolName, spanType: SpanType.TOOL }
  );
}

export async function traceAgentTurn<T>(args: {
  sessionId: string;
  turnId: string;
  userText: string;
  turnPath?: string;
  fn: () => Promise<T>;
}): Promise<T> {
  if (!(await ensureMlflowTracingReady()) || !agentIdentity) {
    return args.fn();
  }

  const identity = agentIdentity;
  return withSpan(
    async (span) => {
      span.setSpanType(SpanType.AGENT);
      span.setInputs({
        userText: args.userText,
        sessionId: args.sessionId,
        turnId: args.turnId,
        turnPath: args.turnPath ?? "agent_turn"
      });
      span.setAttributes({
        ...baseTraceTags(identity),
        "turn.id": args.turnId,
        "mlflow.trace.session": args.sessionId
      });

      updateCurrentTrace({
        tags: normalizeStringRecord(baseTraceTags(identity)),
        metadata: baseTraceMetadata(identity, args.sessionId, args.turnId),
        clientRequestId: args.turnId,
        requestPreview: previewText(args.userText)
      });

      try {
        const result = await args.fn();
        const response =
          typeof result === "object" && result !== null && "response" in result
            ? String((result as { response?: string }).response ?? "")
            : "";
        const warnings =
          typeof result === "object" && result !== null && "warnings" in result
            ? ((result as { warnings?: string[] }).warnings ?? [])
            : [];
        const { judgeFields, traceTags, traceMetadata } = readTurnTraceExport(result);
        const requirementText = buildJudgeTraceInputs({
          effectiveUserText: judgeFields.effectiveUserText,
          userText: args.userText
        });
        const judgeOutputs = buildJudgeTraceOutputs({
          requirementText,
          generatedResponse: response,
          turtlePresent: judgeFields.turtlePresent ?? false,
          confirmationAck: judgeFields.confirmationAck ?? false,
          warnings
        });

        updateCurrentTrace({
          requestPreview: previewText(requirementText),
          responsePreview: previewText(response),
          tags: mergeTraceTagRecords(baseTraceTags(identity), traceTags, {
            "turn.path": args.turnPath ?? "agent_turn",
            "turn.warning_count": warnings.length
          }),
          metadata: mergeTraceTagRecords(
            baseTraceMetadata(identity, args.sessionId, args.turnId),
            traceMetadata
          )
        });
        span.setInputs(requirementText);
        span.end({ outputs: judgeOutputs });
        await flushCompositeTraces();
        return attachTurnTraceCorrelation(result, args.turnId, getActiveMlflowTraceId());
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.end({ status: SpanStatusCode.ERROR });
        await flushCompositeTraces();
        throw error;
      }
    },
    { name: "agent_turn", spanType: SpanType.AGENT }
  );
}

/** @internal Test helper */
export function resetMlflowTracingStateForTests(): void {
  tracingReady = false;
  tracingEnabled = false;
  tracingConfig = null;
  activeExperimentId = null;
  agentIdentity = null;
}
