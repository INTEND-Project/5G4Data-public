import { traceable, getCurrentRunTree } from "langsmith/traceable";
import type { AppConfig } from "../config.js";
import type { LlmCallRecord, ModelInvocationResult, ModelInvokeOptions } from "../models.js";

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

const PREVIEW_MAX = 1000;

let tracingReady = false;
let tracingEnabled = false;
let agentIdentity: AgentTraceIdentity | null = null;
let activeProject: string | null = null;

export function isLangSmithTracingEnabled(): boolean {
  return tracingReady && tracingEnabled;
}

/** @deprecated Use isLangSmithTracingEnabled */
export function isMlflowTracingEnabled(): boolean {
  return isLangSmithTracingEnabled();
}

export function previewText(value: string, max = PREVIEW_MAX): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= 1) return trimmed.slice(0, max);
  return `${trimmed.slice(0, max - 1)}…`;
}

export function normalizeStringRecord(
  input: Record<string, unknown> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

export function buildLlmTraceTags(call: LlmCallRecord): Record<string, string> {
  return {
    "llm.provider": call.provider,
    "llm.model": call.model,
    "llm.stage": call.stage,
    "llm.temperature": String(call.temperature),
    "llm.input_tokens": String(call.usage.inputTokens),
    "llm.output_tokens": String(call.usage.outputTokens),
    "llm.total_tokens": String(call.usage.totalTokens),
    "llm.latency_ms": String(call.latencyMs)
  };
}

export async function initializeLangSmithTracing(
  config: AppConfig,
  identity: AgentTraceIdentity
): Promise<void> {
  agentIdentity = identity;
  tracingEnabled = config.langsmithTracingEnabled;
  if (!tracingEnabled) {
    tracingReady = false;
    return;
  }
  const apiKey = config.langsmithApiKey || process.env.LANGSMITH_API_KEY?.trim();
  if (!apiKey) {
    process.stderr.write(
      "[LangSmith] LANGSMITH_TRACING enabled but LANGSMITH_API_KEY is unset; tracing disabled.\n"
    );
    tracingEnabled = false;
    tracingReady = false;
    return;
  }
  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_API_KEY = apiKey;
  if (config.langsmithEndpoint) {
    process.env.LANGSMITH_ENDPOINT = config.langsmithEndpoint;
  }
  activeProject =
    config.langsmithProject?.trim() ||
    identity.packageName ||
    identity.agentName ||
    "langgraph-agents";
  process.env.LANGSMITH_PROJECT = activeProject;
  if (!process.env.LANGCHAIN_CALLBACKS_BACKGROUND) {
    process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "true";
  }
  tracingReady = true;
  process.stdout.write(`[LangSmith] tracing enabled project=${activeProject}\n`);
}

/** @deprecated */
export async function initializeMlflowTracing(
  config: AppConfig,
  identity: AgentTraceIdentity
): Promise<void> {
  return initializeLangSmithTracing(config, identity);
}

export async function shutdownLangSmithTracing(): Promise<void> {
  tracingReady = false;
  tracingEnabled = false;
  agentIdentity = null;
  activeProject = null;
}

/** @deprecated */
export async function shutdownMlflowTracing(): Promise<void> {
  return shutdownLangSmithTracing();
}

export function updateCurrentTraceTags(args: {
  tags?: Record<string, string>;
  metadata?: Record<string, string>;
  requestPreview?: string;
}): void {
  if (!isLangSmithTracingEnabled()) return;
  try {
    const run = getCurrentRunTree();
    if (!run) return;
    if (args.tags) {
      run.extra = {
        ...(run.extra ?? {}),
        metadata: {
          ...((run.extra as { metadata?: Record<string, string> } | undefined)?.metadata ?? {}),
          ...args.tags,
          ...(args.metadata ?? {})
        }
      };
    }
    if (args.requestPreview) {
      run.inputs = { ...(run.inputs as object), preview: args.requestPreview };
    }
  } catch {
    // no active run
  }
}

/** Compatibility shim for former MLflow updateCurrentTrace calls. */
export function updateCurrentTrace(args: {
  tags?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestPreview?: string;
}): void {
  updateCurrentTraceTags({
    tags: normalizeStringRecord(args.tags),
    metadata: normalizeStringRecord(args.metadata),
    requestPreview: args.requestPreview
  });
}

export async function traceToolCall<T>(
  name: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T> | T
): Promise<T> {
  if (!isLangSmithTracingEnabled()) {
    return await fn();
  }
  const wrapped = traceable(
    async () => fn(),
    {
      name,
      run_type: "tool",
      metadata: {
        ...normalizeStringRecord(inputs),
        ...(agentIdentity
          ? {
              "agent.name": agentIdentity.agentName,
              "package.name": agentIdentity.packageName
            }
          : {})
      }
    }
  );
  return wrapped();
}

export async function traceAgentTurn<T extends { turnId?: string; response?: string }>(args: {
  sessionId: string;
  turnId: string;
  userText: string;
  fn: () => Promise<T>;
}): Promise<T & { langsmithTraceId?: string; mlflowTraceId?: string }> {
  if (!isLangSmithTracingEnabled()) {
    return args.fn();
  }
  let runId: string | undefined;
  const wrapped = traceable(
    async () => {
      try {
        const run = getCurrentRunTree();
        runId = run?.id;
      } catch {
        // ignore
      }
      const result = await args.fn();
      return result;
    },
    {
      name: "agent_turn",
      run_type: "chain",
      metadata: {
        sessionId: args.sessionId,
        turnId: args.turnId,
        ...(agentIdentity
          ? {
              "agent.name": agentIdentity.agentName,
              "package.name": agentIdentity.packageName,
              "package.version": agentIdentity.packageVersion,
              "api.port": String(agentIdentity.apiPort)
            }
          : {})
      },
      tags: agentIdentity
        ? [agentIdentity.packageName, agentIdentity.agentName]
        : ["langgraph-agents"]
    }
  );
  const result = await wrapped();
  return {
    ...result,
    langsmithTraceId: runId,
    mlflowTraceId: runId
  };
}

export function wrapTracedModelInvoker(invoke: ModelInvoker): ModelInvoker {
  if (!isLangSmithTracingEnabled()) {
    return invoke;
  }
  return async (messages, options) => {
    const stage = options?.stage ?? "llm";
    const wrapped = traceable(
      async (msgs: ModelMessage[], opts?: ModelInvokeOptions) => invoke(msgs, opts),
      {
        name: `llm_${stage}`,
        run_type: "llm",
        metadata: {
          stage,
          ...(agentIdentity
            ? {
                "agent.name": agentIdentity.agentName,
                "package.name": agentIdentity.packageName
              }
            : {})
        }
      }
    );
    return wrapped(messages, options);
  };
}

export function getActiveLangSmithProject(): string | null {
  return activeProject;
}
