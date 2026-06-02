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
  GRAPHDB_USERNAME: z.string().optional(),
  GRAPHDB_PASSWORD: z.string().optional(),
  PROMETHEUS_URL: z
    .string()
    .url()
    .default("https://start5g-1.cs.uit.no/prometheus"),
  PUSHGATEWAY_URL: z.string().url().default("http://127.0.0.1:9091"),
  GRAFANA_BASE_URL: z
    .string()
    .url()
    .default("https://start5g-1.cs.uit.no/grafana"),
  GRAFANA_ADMIN_USER: z.string().default("admin"),
  GRAFANA_ADMIN_PASSWORD: z.string().optional(),
  GRAFANA_API_KEY: z.string().optional(),
  GRAFANA_USER_EMAIL_DOMAIN: z.string().default("simulator.local"),
  GRAFANA_ORG_ID: z.coerce.number().int().positive().optional(),
  GRAFANA_JWT_SECRET: z.string().optional(),
  GRAFANA_JWT_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  /** Comma-separated Controller usernames that get Grafana org role Editor in JWT (default: arneme). */
  GRAFANA_JWT_EDITOR_USERS: z.string().default("arneme"),
  GRAFANA_TIMESERIES_DASHBOARD_UID: z.string().default("Simulator-5g4data-Metrics"),
  GRAFANA_TIMESERIES_DASHBOARD_SLUG: z
    .string()
    .default("simulator-intent-and-condition-metrics-timeseries-dashboard"),
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
  graphDbUsername?: string;
  graphDbPassword?: string;
  prometheusUrl: string;
  pushgatewayUrl: string;
  grafanaBaseUrl?: string;
  grafanaAdminUser: string;
  grafanaAdminPassword?: string;
  grafanaApiKey?: string;
  grafanaUserEmailDomain: string;
  grafanaOrgId?: number;
  grafanaJwtSecret?: string;
  grafanaJwtTtlSeconds: number;
  grafanaJwtEditorUsers: string;
  grafanaTimeseriesDashboardUid: string;
  grafanaTimeseriesDashboardSlug: string;
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
    GRAPHDB_USERNAME: source.GRAPHDB_USERNAME,
    GRAPHDB_PASSWORD: source.GRAPHDB_PASSWORD,
    PROMETHEUS_URL: source.PROMETHEUS_URL,
    PUSHGATEWAY_URL: source.PUSHGATEWAY_URL,
    GRAFANA_BASE_URL: source.GRAFANA_BASE_URL,
    GRAFANA_ADMIN_USER: source.GRAFANA_ADMIN_USER,
    GRAFANA_ADMIN_PASSWORD: source.GRAFANA_ADMIN_PASSWORD,
    GRAFANA_API_KEY: source.GRAFANA_API_KEY,
    GRAFANA_USER_EMAIL_DOMAIN: source.GRAFANA_USER_EMAIL_DOMAIN,
    GRAFANA_ORG_ID: source.GRAFANA_ORG_ID,
    GRAFANA_JWT_SECRET: source.GRAFANA_JWT_SECRET,
    GRAFANA_JWT_TTL_SECONDS: source.GRAFANA_JWT_TTL_SECONDS,
    GRAFANA_JWT_EDITOR_USERS: source.GRAFANA_JWT_EDITOR_USERS,
    GRAFANA_TIMESERIES_DASHBOARD_UID: source.GRAFANA_TIMESERIES_DASHBOARD_UID,
    GRAFANA_TIMESERIES_DASHBOARD_SLUG: source.GRAFANA_TIMESERIES_DASHBOARD_SLUG,
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
    graphDbUsername: parsed.GRAPHDB_USERNAME?.trim() || undefined,
    graphDbPassword:
      parsed.GRAPHDB_PASSWORD !== undefined && parsed.GRAPHDB_PASSWORD.length > 0
        ? parsed.GRAPHDB_PASSWORD
        : undefined,
    prometheusUrl: parsed.PROMETHEUS_URL,
    pushgatewayUrl: parsed.PUSHGATEWAY_URL,
    grafanaBaseUrl: parsed.GRAFANA_BASE_URL?.trim() || undefined,
    grafanaAdminUser: parsed.GRAFANA_ADMIN_USER,
    grafanaAdminPassword: parsed.GRAFANA_ADMIN_PASSWORD?.trim() || undefined,
    grafanaApiKey: parsed.GRAFANA_API_KEY?.trim() || undefined,
    grafanaUserEmailDomain: parsed.GRAFANA_USER_EMAIL_DOMAIN,
    grafanaOrgId: parsed.GRAFANA_ORG_ID,
    grafanaJwtSecret: parsed.GRAFANA_JWT_SECRET?.trim() || undefined,
    grafanaJwtTtlSeconds: parsed.GRAFANA_JWT_TTL_SECONDS,
    grafanaJwtEditorUsers: parsed.GRAFANA_JWT_EDITOR_USERS,
    grafanaTimeseriesDashboardUid: parsed.GRAFANA_TIMESERIES_DASHBOARD_UID,
    grafanaTimeseriesDashboardSlug: parsed.GRAFANA_TIMESERIES_DASHBOARD_SLUG,
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
