import type { AppEnv } from "@/lib/env";

const DEFAULT_AGENT_API_KEY_HEADER = "X-Api-Key";

interface ApiKeySecurityScheme {
  type?: string;
  in?: string;
  name?: string;
}

interface AgentCardAuthShape {
  name?: string;
  securitySchemes?: Record<string, ApiKeySecurityScheme>;
  security?: Array<Record<string, string[]>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function agentSlugFromWellKnownUri(wellKnownUri: string): string | undefined {
  try {
    const pathname = new URL(wellKnownUri).pathname;
    const marker = "/.well-known/";
    const index = pathname.indexOf(marker);
    if (index <= 0) return undefined;
    const prefix = pathname.slice(0, index);
    const segments = prefix.split("/").filter(Boolean);
    return segments.at(-1);
  } catch {
    return undefined;
  }
}

export function resolveAgentApiKey(
  agentName: string | undefined,
  env: AppEnv,
  wellKnownUri?: string
): string | undefined {
  if (agentName && env.agentApiKeys[agentName]) {
    return env.agentApiKeys[agentName];
  }
  const slug = wellKnownUri ? agentSlugFromWellKnownUri(wellKnownUri) : undefined;
  if (slug && env.agentApiKeys[slug]) {
    return env.agentApiKeys[slug];
  }
  return env.agentApiKey;
}

function resolveApiKeyHeaderName(card?: AgentCardAuthShape, env?: AppEnv): string {
  if (card?.securitySchemes) {
    for (const scheme of Object.values(card.securitySchemes)) {
      if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name) {
        return scheme.name;
      }
    }
  }
  return env?.agentApiKeyHeader ?? DEFAULT_AGENT_API_KEY_HEADER;
}

export function buildA2AAuthHeaders(
  env: AppEnv,
  options?: {
    card?: unknown;
    wellKnownUri?: string;
    agentName?: string;
  }
): Record<string, string> {
  const card = isRecord(options?.card) ? (options.card as AgentCardAuthShape) : undefined;
  const agentName = options?.agentName ?? card?.name;
  const apiKey = resolveAgentApiKey(agentName, env, options?.wellKnownUri);
  if (!apiKey) return {};
  const headerName = resolveApiKeyHeaderName(card, env);
  return { [headerName]: apiKey };
}
