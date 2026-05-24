import { randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_AGENT_API_KEY_SCHEME = "agent-api-key";
export const DEFAULT_AGENT_API_KEY_HEADER = "X-Api-Key";

export interface ApiKeySecurityScheme {
  type: "apiKey";
  in: "header" | "query" | "cookie";
  name: string;
  description?: string;
}

export type SecurityScheme = ApiKeySecurityScheme;

export interface AgentAuthConfig {
  enabled: boolean;
  expectedKey: string;
  schemeName: string;
  headerName: string;
  securitySchemes: Record<string, SecurityScheme>;
  security: Array<Record<string, string[]>>;
}

export interface UnauthorizedHttpResponse {
  status: 401;
  headers: Record<string, string>;
  body: string;
}

export function generateAgentApiKey(): string {
  return randomBytes(32).toString("hex");
}

export function buildAgentSecurityConfig(
  apiKey: string,
  options?: {
    schemeName?: string;
    headerName?: string;
    description?: string;
  }
): Pick<AgentAuthConfig, "securitySchemes" | "security" | "schemeName" | "headerName"> {
  const schemeName = options?.schemeName ?? DEFAULT_AGENT_API_KEY_SCHEME;
  const headerName = options?.headerName ?? DEFAULT_AGENT_API_KEY_HEADER;
  const securitySchemes: Record<string, SecurityScheme> = {
    [schemeName]: {
      type: "apiKey",
      in: "header",
      name: headerName,
      description:
        options?.description ??
        "Shared service API key required for agent invocation and discovery."
    }
  };
  return {
    schemeName,
    headerName,
    securitySchemes,
    security: [{ [schemeName]: [] }]
  };
}

export function resolveAgentAuthConfig(
  apiKey: string | undefined,
  headerName?: string
): AgentAuthConfig | null {
  const trimmedKey = apiKey?.trim();
  if (!trimmedKey) return null;
  const built = buildAgentSecurityConfig(trimmedKey, { headerName });
  return {
    enabled: true,
    expectedKey: trimmedKey,
    ...built
  };
}

export function extractApiKeyFromRequest(
  headers: Record<string, string | string[] | undefined>,
  query: URLSearchParams,
  cookieHeader: string | undefined,
  scheme: ApiKeySecurityScheme
): string | undefined {
  if (scheme.in === "header") {
    const raw = headers[scheme.name.toLowerCase()];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (Array.isArray(raw)) {
      const first = raw.find((value) => typeof value === "string" && value.trim());
      if (first) return first.trim();
    }
    return undefined;
  }
  if (scheme.in === "query") {
    const value = query.get(scheme.name);
    return value?.trim() || undefined;
  }
  if (scheme.in === "cookie" && cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      if (name !== scheme.name) continue;
      const value = trimmed.slice(eq + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}

export function verifyApiKey(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export function unauthorizedResponse(
  schemeName: string,
  headerName: string
): UnauthorizedHttpResponse {
  return {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": `ApiKey realm="agent", scheme="${schemeName}", header="${headerName}"`
    },
    body: JSON.stringify({
      error: "Unauthorized",
      message: "Missing or invalid API key.",
      securityScheme: schemeName,
      header: headerName
    })
  };
}

export function isAuthorizedRequest(
  auth: AgentAuthConfig,
  headers: Record<string, string | string[] | undefined>,
  query: URLSearchParams,
  cookieHeader: string | undefined
): boolean {
  const scheme = auth.securitySchemes[auth.schemeName];
  if (!scheme || scheme.type !== "apiKey") return false;
  const provided = extractApiKeyFromRequest(headers, query, cookieHeader, scheme);
  return verifyApiKey(provided, auth.expectedKey);
}
