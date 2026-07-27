import { NextResponse } from "next/server";
import { z } from "zod";

import { observationProgressUrlFromAgentRpcUrl } from "@/lib/a2a/agent-control-url";
import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { loadAppEnv } from "@/lib/env";
import { fetchAgentRpcUrlFromWellKnown } from "@/lib/observation-agent/fetch-agent-rpc";
import type { ObservationProgressResponse } from "@/lib/observation-agent/progress-types";
import { listRegistryRecords } from "@/lib/registry/client";
import { pickObservationControlAgent } from "@/lib/registry/observation-agent-discovery";

const querySchema = z.object({
  domain: z.string().trim().min(1),
  intentId: z.string().trim().min(1),
});

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    domain: searchParams.get("domain") ?? "",
    intentId: searchParams.get("intentId") ?? "",
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const { domain, intentId } = parsedQuery.data;
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
  const authHeaders = buildA2AAuthHeaders(env, {
    wellKnownUri: match.wellKnownURI,
    agentName: match.name,
  });
  const rpc = await fetchAgentRpcUrlFromWellKnown(match.wellKnownURI, authHeaders);
  if (!rpc.ok) {
    return NextResponse.json({ error: rpc.message }, { status: 502 });
  }

  const progressUrl = new URL(
    observationProgressUrlFromAgentRpcUrl(
      rpc.rpcUrl,
      env.observationAgentControlBaseUrl,
    ),
  );
  progressUrl.searchParams.set("intentId", intentId);

  let response: Response;
  try {
    response = await fetch(progressUrl.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch observation progress: ${String(err)}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `Observation agent progress GET failed (${response.status}).` },
      { status: 502 },
    );
  }

  const body = (await response.json().catch(() => ({}))) as ObservationProgressResponse & {
    error?: string;
  };

  const progress = body.progress ?? null;
  const status =
    body.status === "active" || (progress && typeof progress === "object")
      ? "active"
      : "idle";

  return NextResponse.json({
    status,
    progress,
  });
}
