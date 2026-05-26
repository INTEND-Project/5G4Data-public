import { z } from "zod";

import { getConfiguredAppBasePath } from "@/lib/app-paths";

const agentApiKeysSchema = z
  .string()
  .optional()
  .transform((value) => {
    if (!value?.trim()) return {} as Record<string, string>;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {} as Record<string, string>;
      }
      const result: Record<string, string> = {};
      for (const [key, entry] of Object.entries(parsed)) {
        if (typeof entry === "string" && entry.trim()) {
          result[key] = entry.trim();
        }
      }
      return result;
    } catch {
      return {} as Record<string, string>;
    }
  });

const appEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  A2A_REGISTRY_BASE_URL: z
    .string()
    .url()
    .default("https://start5g-1.cs.uit.no/a2a-registry"),
  GRAPHDB_BASE_URL: z
    .string()
    .url()
    .default("https://start5g-1.cs.uit.no/graphdb/"),
  PROMETHEUS_URL: z.string().url().default("http://127.0.0.1:9090/"),
  PUSHGATEWAY_URL: z.string().url().default("http://127.0.0.1:9091"),
  APP_BASE_PATH: z.string().optional(),
  ASSISTANT_MODEL: z.string().default("gpt-4.1-mini"),
  ASSISTANT_API_KEY: z.string().optional(),
  AGENT_API_KEYS: agentApiKeysSchema,
  AGENT_API_KEY: z.string().optional(),
  AGENT_API_KEY_HEADER: z.string().default("X-Api-Key"),
});

export type AppEnv = {
  databaseUrl: string;
  a2aRegistryBaseUrl: string;
  graphDbBaseUrl: string;
  prometheusUrl: string;
  pushgatewayUrl: string;
  appBasePath: string;
  assistantModel: string;
  assistantApiKey?: string;
  agentApiKeys: Record<string, string>;
  agentApiKey?: string;
  agentApiKeyHeader: string;
};

export function loadAppEnv(source: Partial<Record<string, string | undefined>>): AppEnv {
  const parsed = appEnvSchema.parse({
    DATABASE_URL: source.DATABASE_URL,
    A2A_REGISTRY_BASE_URL: source.A2A_REGISTRY_BASE_URL,
    GRAPHDB_BASE_URL: source.GRAPHDB_BASE_URL,
    PROMETHEUS_URL: source.PROMETHEUS_URL,
    PUSHGATEWAY_URL: source.PUSHGATEWAY_URL,
    APP_BASE_PATH: source.APP_BASE_PATH,
    ASSISTANT_MODEL: source.ASSISTANT_MODEL,
    ASSISTANT_API_KEY: source.ASSISTANT_API_KEY,
    AGENT_API_KEYS: source.AGENT_API_KEYS,
    AGENT_API_KEY: source.AGENT_API_KEY,
    AGENT_API_KEY_HEADER: source.AGENT_API_KEY_HEADER,
  });

  return {
    databaseUrl: parsed.DATABASE_URL,
    a2aRegistryBaseUrl: parsed.A2A_REGISTRY_BASE_URL,
    graphDbBaseUrl: parsed.GRAPHDB_BASE_URL,
    prometheusUrl: parsed.PROMETHEUS_URL,
    pushgatewayUrl: parsed.PUSHGATEWAY_URL,
    appBasePath: getConfiguredAppBasePath({
      APP_BASE_PATH: parsed.APP_BASE_PATH,
    }),
    assistantModel: parsed.ASSISTANT_MODEL,
    assistantApiKey: parsed.ASSISTANT_API_KEY,
    agentApiKeys: parsed.AGENT_API_KEYS,
    agentApiKey: parsed.AGENT_API_KEY?.trim() || undefined,
    agentApiKeyHeader: parsed.AGENT_API_KEY_HEADER,
  };
}
