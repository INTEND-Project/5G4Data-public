import { NextResponse } from "next/server";
import { z } from "zod";

import { workloadPreviewUrlFromAgentRpcUrl } from "@/lib/a2a/agent-control-url";
import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { loadAppEnv } from "@/lib/env";
import { listRegistryRecords } from "@/lib/registry/client";
import { pickIntentGeneratingAgent } from "@/lib/registry/intent-agent-discovery";

const bodySchema = z.object({
  prompt: z.string().min(1),
  domain: z.string().min(1),
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

  const { prompt, domain } = parsedBody.data;
  const env = loadAppEnv(process.env);

  const records = await listRegistryRecords({ forceRefresh: false });
  const match = pickIntentGeneratingAgent(records, domain);
  if (!match?.wellKnownURI) {
    return NextResponse.json(
      {
        error: `No intent-generating agent found for domain "${domain}" in the registry.`,
      },
      { status: 404 },
    );
  }

  const initialAuthHeaders = buildA2AAuthHeaders(env, {
    wellKnownUri: match.wellKnownURI,
  });
  const rpc = await fetchAgentRpcUrl(match.wellKnownURI, initialAuthHeaders);
  if (!rpc.ok) {
    return NextResponse.json({ error: rpc.message }, { status: 502 });
  }

  const authHeaders = buildA2AAuthHeaders(env, {
    card: rpc.card,
    wellKnownUri: match.wellKnownURI,
  });
  const previewUrl = workloadPreviewUrlFromAgentRpcUrl(rpc.rpcUrl);

  let previewResponse: Response;
  try {
    previewResponse = await fetch(previewUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({ prompt }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Workload preview request failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const previewBody = (await previewResponse.json().catch(() => ({}))) as Record<string, unknown>;

  if (previewResponse.status === 501) {
    return NextResponse.json(
      {
        error:
          "Intent agent does not support workload preview; restart the agent after upgrading.",
      },
      { status: 502 },
    );
  }

  if (!previewResponse.ok) {
    const message =
      typeof previewBody.error === "string" && previewBody.error.length > 0
        ? previewBody.error
        : `Workload preview failed (${previewResponse.status}).`;
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json(previewBody);
}
