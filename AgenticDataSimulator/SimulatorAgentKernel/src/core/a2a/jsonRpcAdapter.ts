import { randomUUID } from "node:crypto";
import { createSession } from "../turnOrchestrator.js";
import {
  bindingsConflict,
  parseGraphTargetBindingFromMetadata,
  parseOpenClawControllerMetadata
} from "../graphTargetBinding.js";
import type { AgentTurnResult, ChatSession } from "../../models.js";

export interface A2AJsonRpcAdapterDeps {
  runTurn(session: ChatSession, userText: string): Promise<AgentTurnResult>;
}

interface A2ABinding {
  session: ChatSession;
  contextId: string;
}

interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: { details?: string };
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

interface TextPart {
  kind: string;
  text?: string;
}

interface IncomingMessageShape {
  role?: string;
  parts?: unknown;
  taskId?: string;
  contextId?: string;
  messageId?: string;
  metadata?: unknown;
}

const SEND_METHODS = new Set(["message/send", "SendMessage"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const raw of parts) {
    if (!isRecord(raw)) continue;
    if (raw.kind !== "text" && raw.kind !== undefined) continue;
    const textPart = raw as unknown as TextPart;
    if (typeof textPart.text === "string" && textPart.text.length > 0) {
      chunks.push(textPart.text);
    }
  }
  return chunks.join("\n").trim();
}

function jsonRpcResult(id: string | number | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: string | number | null | undefined, err: JsonRpcErrorBody): string {
  const safeId = id === undefined ? null : id;
  return JSON.stringify({ jsonrpc: "2.0", id: safeId, error: err });
}

function parseIncomingMessage(params: Record<string, unknown>): IncomingMessageShape | null {
  const message = params.message;
  if (!isRecord(message)) return null;
  return message as IncomingMessageShape;
}

function buildCompletedTaskResult(options: {
  taskId: string;
  contextId: string;
  userMessageId: string;
  userText: string;
  agentText: string;
  turnId?: string;
  mlflowTraceId?: string;
}): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  const result: Record<string, unknown> = {
    kind: "task",
    id: options.taskId,
    contextId: options.contextId,
    status: {
      state: "completed",
      timestamp
    },
    artifacts: [
      {
        artifactId: randomUUID(),
        name: "openclaw-response",
        parts: [{ kind: "text", text: options.agentText }]
      }
    ],
    history: [
      {
        role: "user",
        parts: [{ kind: "text", text: options.userText }],
        messageId: options.userMessageId,
        taskId: options.taskId,
        contextId: options.contextId
      }
    ]
  };

  if (options.turnId || options.mlflowTraceId) {
    result.metadata = {
      openclaw: {
        agentTraceVersion: "1",
        ...(options.turnId ? { turnId: options.turnId } : {}),
        ...(options.mlflowTraceId ? { mlflowTraceId: options.mlflowTraceId } : {})
      }
    };
  }

  return result;
}

type PreparedSend =
  | {
      ok: true;
      id: string | number | null;
      taskId: string;
      contextId: string;
      session: ChatSession;
      userText: string;
      userMessageId: string;
    }
  | { ok: false; httpStatus: number; body: string };

function applyOpenClawMetadataToSession(
  session: ChatSession,
  incoming: IncomingMessageShape
): PreparedSend | null {
  const parsed = parseOpenClawControllerMetadata(incoming.metadata);
  if (!parsed) return null;

  const graphTarget = parsed.graphTarget;
  if (graphTarget && bindingsConflict(session.graphTargetBinding, graphTarget)) {
    return {
      ok: false,
      httpStatus: 200,
      body: jsonRpcError(null, {
        code: -32602,
        message: "Invalid params.",
        data: {
          details:
            "graphTarget metadata conflicts with the binding established for this taskId."
        }
      })
    };
  }
  if (graphTarget && !session.graphTargetBinding) {
    session.graphTargetBinding = graphTarget;
  }
  if (parsed.observationStorage) {
    session.observationStorage = parsed.observationStorage;
  }
  if (parsed.createIntentStorage && !session.createIntentStorage) {
    session.createIntentStorage = parsed.createIntentStorage;
  }
  if (parsed.llmModel) {
    session.llmModelOverride = parsed.llmModel;
  }
  if (parsed.llmApiBaseUrl) {
    session.llmApiBaseUrlOverride = parsed.llmApiBaseUrl;
  }
  if (parsed.temperature !== null) {
    session.temperatureOverride = parsed.temperature;
  }
  if (parsed.reportingIntervalMinutes !== null) {
    session.reportingIntervalMinutesOverride = parsed.reportingIntervalMinutes;
  }
  if (parsed.reportingIntervalSeconds !== null) {
    session.reportingIntervalSecondsOverride = parsed.reportingIntervalSeconds;
  }
  if (parsed.prometheusBaseUrl) {
    session.prometheusBaseUrl = parsed.prometheusBaseUrl;
    session.prometheusStorageMode =
      parsed.prometheusStorageMode ??
      (parsed.prometheusBaseUrl.includes("127.0.0.1") ||
      parsed.prometheusBaseUrl.includes("localhost") ||
      parsed.prometheusBaseUrl.includes("host.docker.internal")
        ? "local"
        : "external");
  }
  return null;
}

export class A2AJsonRpcAdapter {
  private readonly bindings = new Map<string, A2ABinding>();

  constructor(private readonly deps: A2AJsonRpcAdapterDeps) {}

  private prepareSendMessage(req: JsonRpcRequest): PreparedSend {
    if (!isRecord(req) || req.jsonrpc !== "2.0") {
      return {
        ok: false,
        httpStatus: 400,
        body: jsonRpcError(null, {
          code: -32600,
          message: "Invalid Request.",
          data: { details: 'Body must be a JSON-RPC 2.0 object with "jsonrpc":"2.0".' }
        })
      };
    }

    const id = req.id === undefined ? null : req.id;
    const method = typeof req.method === "string" ? req.method : "";

    if (!SEND_METHODS.has(method)) {
      return {
        ok: false,
        httpStatus: 200,
        body: jsonRpcError(id, {
          code: -32601,
          message: method ? `Method not found: ${method}` : "Method not found.",
          data: {
            details: "Supported methods: message/send (A2A v0.3) and SendMessage (alias)."
          }
        })
      };
    }

    const params = isRecord(req.params) ? req.params : null;
    if (!params) {
      return {
        ok: false,
        httpStatus: 200,
        body: jsonRpcError(id, {
          code: -32602,
          message: "Invalid params.",
          data: { details: "params must be an object with a message field." }
        })
      };
    }

    const incoming = parseIncomingMessage(params);
    if (!incoming || incoming.role !== "user") {
      return {
        ok: false,
        httpStatus: 200,
        body: jsonRpcError(id, {
          code: -32602,
          message: "Invalid params.",
          data: { details: 'message.role must be "user".' }
        })
      };
    }

    const userText = extractTextFromParts(incoming.parts);
    if (!userText) {
      return {
        ok: false,
        httpStatus: 200,
        body: jsonRpcError(id, {
          code: -32602,
          message: "Invalid params.",
          data: { details: "No text content found in message.parts (expected kind:text parts)." }
        })
      };
    }

    const userMessageId =
      typeof incoming.messageId === "string" && incoming.messageId.length > 0
        ? incoming.messageId
        : randomUUID();

    let taskId: string;
    let contextId: string;
    let session: ChatSession;

    if (typeof incoming.taskId === "string" && incoming.taskId.length > 0) {
      const binding = this.bindings.get(incoming.taskId);
      if (!binding) {
        return {
          ok: false,
          httpStatus: 200,
          body: jsonRpcError(id, {
            code: -32602,
            message: "Invalid params.",
            data: { details: "Unknown taskId; start a turn without taskId to open a new task." }
          })
        };
      }
      taskId = incoming.taskId;
      contextId = binding.contextId;
      session = binding.session;
      const bindingConflict = applyOpenClawMetadataToSession(session, incoming);
      if (bindingConflict) {
        return bindingConflict;
      }
    } else {
      taskId = randomUUID();
      contextId = randomUUID();
      session = createSession();
      const bindingConflict = applyOpenClawMetadataToSession(session, incoming);
      if (bindingConflict) {
        return bindingConflict;
      }
      this.bindings.set(taskId, { session, contextId });
    }

    return {
      ok: true,
      id,
      taskId,
      contextId,
      session,
      userText,
      userMessageId
    };
  }

  async handleRawBodyAsync(rawBody: string): Promise<{ httpStatus: number; body: string }> {
    let parsed: unknown;
    try {
      parsed = rawBody.trim() ? JSON.parse(rawBody) : null;
    } catch {
      return {
        httpStatus: 400,
        body: jsonRpcError(null, { code: -32700, message: "Parse error." })
      };
    }
    const req = parsed as JsonRpcRequest;
    const prepared = this.prepareSendMessage(req);
    if (!prepared.ok) {
      return { httpStatus: prepared.httpStatus, body: prepared.body };
    }

    try {
      const turn = await this.deps.runTurn(prepared.session, prepared.userText);
      const result = buildCompletedTaskResult({
        taskId: prepared.taskId,
        contextId: prepared.contextId,
        userMessageId: prepared.userMessageId,
        userText: prepared.userText,
        agentText: turn.response,
        turnId: turn.turnId,
        mlflowTraceId: turn.mlflowTraceId
      });
      return { httpStatus: 200, body: jsonRpcResult(prepared.id, result) };
    } catch (error) {
      return {
        httpStatus: 200,
        body: jsonRpcError(prepared.id, {
          code: -32603,
          message: "Internal error.",
          data: { details: String(error) }
        })
      };
    }
  }
}
