import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { interpretSendMessageResult } from "@/lib/a2a/interpret-message-result";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { loadAppEnv } from "@/lib/env";
import {
  hasOpenClawMetadataFields,
  openClawMetadataEnvelope,
} from "@/lib/kg/graph-target-binding";
import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";
import { prometheusStackMode } from "@/lib/prometheus/resolve-stack-urls";

const graphTargetSchema = z.object({
  graphTargetId: z.string().optional(),
  repositoryId: z.string().min(1),
  graphIri: z.string().min(1),
  sparqlEndpoint: z.string().url(),
  repositoryBaseUrl: z.string().url().optional(),
});

const bodySchema = z.object({
  wellKnownURI: z.string().url(),
  taskId: z.string().min(1).optional(),
  contextId: z.string().min(1).optional(),
  text: z.string().min(1),
  graphTarget: graphTargetSchema.optional(),
  observationStorage: z.enum(["graphdb", "prometheus"]).optional(),
  createIntentStorage: z.enum(["graphdb", "prometheus"]).optional(),
  llmModel: z.string().trim().optional(),
  temperature: z.number().min(0).max(2).optional(),
  reportingIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  reportingIntervalSeconds: z.number().int().min(1).max(86_400).optional(),
  prometheusBaseUrl: z.string().trim().optional(),
});

async function fetchAgentRpcUrl(
  wellKnownURI: string,
  authHeaders: Record<string, string>
): Promise<
  | { ok: true; rpcUrl: string; card: Record<string, unknown> }
  | { ok: false; message: string }
> {
  let response: Response;
  try {
    response = await fetch(wellKnownURI, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
    });
  } catch (err) {
    return {
      ok: false,
      message: `Failed to fetch agent card: ${String(err)}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `Agent card GET failed (${response.status}).`,
    };
  }

  let card: unknown;
  try {
    card = await response.json();
  } catch {
    return { ok: false, message: "Agent card response was not JSON." };
  }

  if (!card || typeof card !== "object") {
    return { ok: false, message: "Agent card payload invalid." };
  }

  const cardRecord = card as Record<string, unknown>;
  const url = cardRecord.url;
  if (typeof url !== "string" || !url.length) {
    return { ok: false, message: "Agent card missing string field url." };
  }

  return { ok: true, rpcUrl: url, card: cardRecord };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = bodySchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const body = parsedBody.data;

  let prometheusBaseUrl: string | undefined;
  let prometheusStorageMode: ReturnType<typeof prometheusStackMode> | undefined;
  if (body.prometheusBaseUrl?.trim()) {
    const parsedProm = parsePrometheusBaseUrlInput(body.prometheusBaseUrl);
    if (!parsedProm.ok) {
      return NextResponse.json({ error: parsedProm.error }, { status: 400 });
    }
    prometheusBaseUrl = parsedProm.url;
    prometheusStorageMode = prometheusStackMode(prometheusBaseUrl);
  }

  const env = loadAppEnv(process.env);
  const initialAuthHeaders = buildA2AAuthHeaders(env, { wellKnownUri: body.wellKnownURI });
  const rpc = await fetchAgentRpcUrl(body.wellKnownURI, initialAuthHeaders);
  if (!rpc.ok) {
    return NextResponse.json({ error: rpc.message }, { status: 502 });
  }

  const rpcUrl = rpc.rpcUrl;
  const authHeaders = buildA2AAuthHeaders(env, {
    card: rpc.card,
    wellKnownUri: body.wellKnownURI,
  });
  /** @see SimulatorAgentKernel/scripts/a2a-interactive.mjs */
  const message: Record<string, unknown> = {
    role: "user",
    messageId: randomUUID(),
    parts: [{ kind: "text", text: body.text }],
  };
  if (body.taskId) {
    message.taskId = body.taskId;
  }
  if (body.contextId) {
    message.contextId = body.contextId;
  }
  const metadataOpts = {
    graphTarget: body.graphTarget,
    observationStorage: body.observationStorage,
    createIntentStorage: body.createIntentStorage,
    prometheusBaseUrl,
    prometheusStorageMode,
    llmModel: body.llmModel,
    temperature: body.temperature,
    reportingIntervalMinutes: body.reportingIntervalMinutes,
    reportingIntervalSeconds: body.reportingIntervalSeconds,
  };
  if (hasOpenClawMetadataFields(metadataOpts)) {
    message.metadata = openClawMetadataEnvelope(metadataOpts);
  }

  const requestId = randomUUID();

  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "a2a-version": "0.3",
        ...authHeaders,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "message/send",
        params: { message },
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `JSON-RPC request failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const textBody = await res.text();
  let data: unknown;
  try {
    data = textBody ? JSON.parse(textBody) : null;
  } catch {
    return NextResponse.json(
      { error: `JSON-RPC upstream returned non-JSON (${res.status}).` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      {
        error: typeof data === "object" && data && "error" in data
          ? JSON.stringify((data as { error: unknown }).error)
          : `HTTP ${res.status}`,
      },
      { status: 502 },
    );
  }

  const interpreted = interpretSendMessageResult(data);
  if (!interpreted.ok) {
    return NextResponse.json({ error: interpreted.errorText }, { status: 502 });
  }

  return NextResponse.json({
    taskId: interpreted.taskId ?? undefined,
    contextId: interpreted.contextId ?? undefined,
    visibleText: interpreted.visibleText,
    needsInput: interpreted.needsInput,
    turnId: interpreted.turnId,
    mlflowTraceId: interpreted.mlflowTraceId,
  });
}
