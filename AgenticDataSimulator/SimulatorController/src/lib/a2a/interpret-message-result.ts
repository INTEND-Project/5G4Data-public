export type ParsedSendMessageResult = {
  ok: true;
  taskId: string | null;
  contextId: string | null;
  visibleText: string;
  needsInput: boolean;
  turnId?: string;
  mlflowTraceId?: string;
} | {
  ok: false;
  errorText: string;
};

function readSimulatorAgentTrace(result: Record<string, unknown>): {
  turnId?: string;
  mlflowTraceId?: string;
} {
  const metadata = result.metadata;
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  const simulator = (metadata as { simulator?: unknown }).simulator;
  if (!simulator || typeof simulator !== "object") {
    return {};
  }
  const trace = simulator as { turnId?: unknown; mlflowTraceId?: unknown };
  const turnId = typeof trace.turnId === "string" && trace.turnId.trim() ? trace.turnId.trim() : undefined;
  const mlflowTraceId =
    typeof trace.mlflowTraceId === "string" && trace.mlflowTraceId.trim()
      ? trace.mlflowTraceId.trim()
      : undefined;
  return { turnId, mlflowTraceId };
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") {
      continue;
    }
    const part = p as { kind?: unknown; text?: unknown };
    if (part.kind !== undefined && part.kind !== "text") {
      continue;
    }
    if (typeof part.text === "string" && part.text.length > 0) {
      chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function textFromArtifact(artifact: unknown): string {
  if (!artifact || typeof artifact !== "object") {
    return "";
  }
  const parts = (artifact as { parts?: unknown }).parts;
  return textFromParts(parts);
}

export function interpretSendMessageResult(envelope: unknown): ParsedSendMessageResult {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, errorText: "Empty or invalid JSON-RPC response." };
  }

  const e = envelope as {
    error?: { code?: number; message?: string; data?: { details?: string } };
    result?: unknown;
  };

  if (e.error) {
    const msg = [e.error.message, e.error.data?.details].filter(Boolean).join(" — ");
    return {
      ok: false,
      errorText: `[${e.error.code ?? "?"}] ${msg}`,
    };
  }

  const result = e.result;
  if (result === undefined || result === null) {
    return { ok: false, errorText: "JSON-RPC result missing." };
  }

  if (typeof result !== "object") {
    return {
      ok: true,
      taskId: null,
      contextId: null,
      visibleText: String(result),
      needsInput: false,
    };
  }

  const r = result as Record<string, unknown>;

  if (r.kind === "message") {
    return {
      ok: true,
      taskId: typeof r.taskId === "string" ? r.taskId : null,
      contextId: typeof r.contextId === "string" ? r.contextId : null,
      visibleText: textFromParts(r.parts),
      needsInput: false,
    };
  }

  const taskId = typeof r.id === "string" ? r.id : null;
  const contextId = typeof r.contextId === "string" ? r.contextId : null;
  const agentTrace = readSimulatorAgentTrace(r);
  const status = r.status as { state?: unknown; message?: { parts?: unknown } } | undefined;
  const state = status?.state;

  if (state === "input-required") {
    const agentTurn = status?.message;
    const hint = agentTurn ? textFromParts(agentTurn.parts) : "(Agent requested further input.)";
    return {
      ok: true,
      taskId,
      contextId,
      visibleText: hint,
      needsInput: true,
      ...agentTrace,
    };
  }

  const artifacts = r.artifacts;
  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const combined = artifacts.map(textFromArtifact).filter(Boolean).join("\n\n");
    if (combined) {
      return {
        ok: true,
        taskId,
        contextId,
        visibleText: combined,
        needsInput: false,
        ...agentTrace,
      };
    }
  }

  return {
    ok: true,
    taskId,
    contextId,
    visibleText: JSON.stringify(r, null, 2),
    needsInput: false,
    ...agentTrace,
  };
}
