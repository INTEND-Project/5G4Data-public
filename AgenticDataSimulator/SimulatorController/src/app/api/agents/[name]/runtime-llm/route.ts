import { NextResponse } from "next/server";

import { agentInfoUrlFromAgentRpcUrl } from "@/lib/a2a/agent-control-url";
import { fetchAgentRpcUrl } from "@/lib/a2a/fetch-agent-card";
import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { DEFAULT_AGENT_TEMPERATURE } from "@/lib/agents/agent-llm-preferences";
import { readEnvFileLlmDefaults } from "@/lib/agents/read-kernel-env-llm-defaults";
import { getAuthenticatedUser } from "@/lib/auth/guards";
import { loadAppEnv } from "@/lib/env";
import { listRegistryRecords } from "@/lib/registry/client";

type RouteContext = {
  params: Promise<{ name: string }>;
};

function clampTemperature(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AGENT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

function runtimeLlmPayload(
  model: string,
  temperature: number,
  source: "agent" | "env",
  apiBaseUrl?: string,
  extra?: Record<string, unknown>,
) {
  return {
    model,
    apiBaseUrl,
    temperature,
    source,
    ...extra,
  };
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
    return NextResponse.json(
      runtimeLlmPayload(
        envFallback.model,
        envFallback.temperature,
        envFallback.source,
        envFallback.apiBaseUrl,
      ),
    );
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
    return NextResponse.json(
      runtimeLlmPayload(
        envFallback.model,
        envFallback.temperature,
        envFallback.source,
        envFallback.apiBaseUrl,
        { warning: rpc.message },
      ),
    );
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
      return NextResponse.json(
        runtimeLlmPayload(
          envFallback.model,
          envFallback.temperature,
          envFallback.source,
          envFallback.apiBaseUrl,
          { warning: `Agent info request failed (${response.status}).` },
        ),
      );
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
      return NextResponse.json(
        runtimeLlmPayload(
          envFallback.model,
          envFallback.temperature,
          envFallback.source,
          envFallback.apiBaseUrl,
          { warning: "Agent info response missing model." },
        ),
      );
    }

    return NextResponse.json(
      runtimeLlmPayload(
        model,
        clampTemperature(
          payload.temperature ?? envFallback?.temperature ?? DEFAULT_AGENT_TEMPERATURE,
        ),
        "agent",
        envFallback?.apiBaseUrl,
      ),
    );
  } catch (err) {
    if (!envFallback) {
      return NextResponse.json(
        { error: `Failed to fetch agent runtime info: ${String(err)}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      runtimeLlmPayload(
        envFallback.model,
        envFallback.temperature,
        envFallback.source,
        envFallback.apiBaseUrl,
        { warning: String(err) },
      ),
    );
  }
}
