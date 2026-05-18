import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { interpretSendMessageResult } from "@/lib/a2a/interpret-message-result";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { openClawMetadataEnvelope } from "@/lib/kg/graph-target-binding";

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
});

async function fetchAgentRpcUrl(wellKnownURI: string): Promise<{ ok: true; rpcUrl: string } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch(wellKnownURI, {
      cache: "no-store",
      headers: { accept: "application/json" },
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

  const url = (card as { url?: unknown }).url;
  if (typeof url !== "string" || !url.length) {
    return { ok: false, message: "Agent card missing string field url." };
  }

  return { ok: true, rpcUrl: url };
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
  const rpc = await fetchAgentRpcUrl(body.wellKnownURI);
  if (!rpc.ok) {
    return NextResponse.json({ error: rpc.message }, { status: 502 });
  }

  const rpcUrl = rpc.rpcUrl;
  /** @see OpenClawAgent/scripts/a2a-interactive.mjs */
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
  if (body.graphTarget) {
    message.metadata = openClawMetadataEnvelope(body.graphTarget);
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
  });
}
