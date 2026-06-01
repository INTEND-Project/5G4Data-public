import { NextResponse } from "next/server";
import { z } from "zod";

import { observationErrorsUrlFromAgentRpcUrl } from "@/lib/a2a/agent-control-url";
import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { loadAppEnv } from "@/lib/env";
import { listRegistryRecords } from "@/lib/registry/client";
import { pickObservationControlAgent } from "@/lib/registry/observation-agent-discovery";

const querySchema = z.object({
  domain: z.string().trim().min(1),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type ObservationAgentErrorEntry = {
  schemaVersion: "observation_error_v1";
  timestampUtc: string;
  kind: string;
  message: string;
  intentId?: string;
  metric?: string;
  sessionId?: string;
  sampleCount?: number;
  remoteWriteUrl?: string;
  exitCode?: number;
};

async function fetchAgentRpcUrl(
  wellKnownURI: string,
  authHeaders: Record<string, string>,
): Promise<
  | { ok: true; rpcUrl: string }
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

  const url = (card as Record<string, unknown>).url;
  if (typeof url !== "string" || !url.length) {
    return { ok: false, message: "Agent card missing string field url." };
  }

  return { ok: true, rpcUrl: url };
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    domain: searchParams.get("domain") ?? "",
    since: searchParams.get("since")?.trim() || undefined,
    limit: searchParams.get("limit")?.trim() || undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const { domain, since, limit } = parsedQuery.data;
  const records = await listRegistryRecords({ forceRefresh: false });
  const match = pickObservationControlAgent(records, domain);

  if (!match) {
    return NextResponse.json(
      {
        error: `No observation-control agent found for domain "${domain}" in the registry.`,
      },
      { status: 404 },
    );
  }

  const env = loadAppEnv(process.env);
  const authHeaders = buildA2AAuthHeaders(env, { wellKnownUri: match.wellKnownURI });
  const rpc = await fetchAgentRpcUrl(match.wellKnownURI, authHeaders);
  if (!rpc.ok) {
    return NextResponse.json({ error: rpc.message }, { status: 502 });
  }

  const errorsUrl = new URL(observationErrorsUrlFromAgentRpcUrl(rpc.rpcUrl));
  if (since) {
    errorsUrl.searchParams.set("since", since);
  }
  if (limit !== undefined) {
    errorsUrl.searchParams.set("limit", String(limit));
  }

  let response: Response;
  try {
    response = await fetch(errorsUrl.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch observation errors: ${String(err)}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `Observation agent errors GET failed (${response.status}).` },
      { status: 502 },
    );
  }

  const body = (await response.json().catch(() => ({}))) as {
    errors?: ObservationAgentErrorEntry[];
    error?: string;
  };

  return NextResponse.json({
    errors: Array.isArray(body.errors) ? body.errors : [],
  });
}
