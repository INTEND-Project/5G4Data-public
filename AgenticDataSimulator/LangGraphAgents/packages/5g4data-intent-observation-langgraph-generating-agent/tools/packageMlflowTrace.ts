/**
 * Bridge observation-package tools to kernel MLflow tracing when running in an agent clone.
 * Falls back to executing fn directly when the kernel module is unavailable (package tests).
 */
type TracingModule = {
  traceToolCall: <R>(
    name: string,
    toolInputs: Record<string, unknown>,
    inner: () => Promise<R>
  ) => Promise<R>;
  getActiveMlflowTraceId?: () => string | null;
};

let tracingModule: TracingModule | null | undefined;

async function loadTracingModule(): Promise<TracingModule | null> {
  if (tracingModule !== undefined) {
    return tracingModule;
  }
  try {
    tracingModule = (await import("../src/tracing/mlflowTracing.js")) as TracingModule;
  } catch {
    tracingModule = null;
  }
  return tracingModule;
}

export async function packageActiveTraceId(): Promise<string | undefined> {
  const mod = await loadTracingModule();
  const id = mod?.getActiveMlflowTraceId?.();
  return id ?? undefined;
}

export async function packageTraceToolCall<T>(
  toolName: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T> | T
): Promise<T> {
  const mod = await loadTracingModule();
  if (!mod) {
    return fn();
  }
  return mod.traceToolCall(toolName, inputs, async () => fn());
}

export async function packageTraceLlmCall<T>(
  stage: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  return packageTraceToolCall(`llm_${stage}`, { ...inputs, spanType: "llm" }, fn);
}
