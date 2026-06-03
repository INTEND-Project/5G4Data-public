import { NextResponse } from "next/server";

import { agentInfoUrlFromAgentRpcUrl } from "@/lib/a2a/agent-control-url";
import { fetchAgentRpcUrl } from "@/lib/a2a/fetch-agent-card";
import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { readEnvFileLlmDefaults } from "@/lib/agents/read-kernel-env-llm-defaults";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { loadAppEnv } from "@/lib/env";
import { listRegistryRecords } from "@/lib/registry/client";

type RouteContext = {
  params: Promise<{ name: string }>;
};

function clampTemperature(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(2, Math.max(0, value));
}

export async function GET(request: Request, context: RouteContext) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name: agentName } = await context.params;
  const decodedName = decodeURIComponent(agentName).trim();
  if (!decodedName) {
    return NextResponse.json({ error: "Agent name is required." }, { status: 400 });
  }

  const envFallback = readEnvFileLlmDefaults(decodedName);

  const records = await listRegistryRecords({ forceRefresh: false });
  const match = records.find((record) => record.name === decodedName);

  if (!match?.wellKnownURI) {
    if (!envFallback) {
      return NextResponse.json({ error: `Agent "${decodedName}" not found in registry.` }, { status: 404 });
    }
    return NextResponse.json({
      model: envFallback.model,
      temperature: envFallback.temperature,
      source: envFallback.source,
    });
  }

  const appEnv = loadAppEnv(process.env);
  const initialAuthHeaders = buildA2AAuthHeaders(appEnv, {
    wellKnownUri: match.wellKnownURI,
    agentName: decodedName,
  });
  const rpc = await fetchAgentRpcUrl(match.wellKnownURI, initialAuthHeaders);

  if (!rpc.ok) {
    if (!envFallback) {
      return NextResponse.json({ error: rpc.message }, { status: 502 });
    }
    return NextResponse.json({
      model: envFallback.model,
      temperature: envFallback.temperature,
      source: envFallback.source,
      warning: rpc.message,
    });
  }

  const authHeaders = buildA2AAuthHeaders(appEnv, {
    card: rpc.card,
    wellKnownUri: match.wellKnownURI,
    agentName: decodedName,
  });
  const infoUrl = agentInfoUrlFromAgentRpcUrl(rpc.rpcUrl);

  try {
    const response = await fetch(infoUrl, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...authHeaders,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      if (!envFallback) {
        return NextResponse.json(
          { error: `Agent info request failed (${response.status}).` },
          { status: 502 },
        );
      }
      return NextResponse.json({
        model: envFallback.model,
        temperature: envFallback.temperature,
        source: envFallback.source,
        warning: `Agent info request failed (${response.status}).`,
      });
    }

    const payload = (await response.json()) as {
      model?: string;
      temperature?: number;
    };

    const model = typeof payload.model === "string" ? payload.model.trim() : "";
    if (!model) {
      if (!envFallback) {
        return NextResponse.json({ error: "Agent info response missing model." }, { status: 502 });
      }
      return NextResponse.json({
        model: envFallback.model,
        temperature: envFallback.temperature,
        source: envFallback.source,
        warning: "Agent info response missing model.",
      });
    }

    return NextResponse.json({
      model,
      temperature: clampTemperature(payload.temperature ?? envFallback?.temperature ?? 0),
      source: "agent" as const,
    });
  } catch (err) {
    if (!envFallback) {
      return NextResponse.json(
        { error: `Failed to fetch agent runtime info: ${String(err)}` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      model: envFallback.model,
      temperature: envFallback.temperature,
      source: envFallback.source,
      warning: String(err),
    });
  }
}
