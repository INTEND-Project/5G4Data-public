import { z } from "zod";

import { getConfiguredAppBasePath } from "@/lib/app-paths";

const appEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  A2A_REGISTRY_BASE_URL: z
    .string()
    .url()
    .default("https://start5g-1.cs.uit.no/a2a-registry"),
  GRAPHDB_BASE_URL: z
    .string()
    .url()
    .default("http://start5g-1.cs.uit.no:7200/"),
  APP_BASE_PATH: z.string().optional(),
  ASSISTANT_MODEL: z.string().default("gpt-4.1-mini"),
  ASSISTANT_API_KEY: z.string().optional(),
});

export type AppEnv = {
  databaseUrl: string;
  a2aRegistryBaseUrl: string;
  graphDbBaseUrl: string;
  appBasePath: string;
  assistantModel: string;
  assistantApiKey?: string;
};

export function loadAppEnv(source: Partial<Record<string, string | undefined>>): AppEnv {
  const parsed = appEnvSchema.parse({
    DATABASE_URL: source.DATABASE_URL,
    A2A_REGISTRY_BASE_URL: source.A2A_REGISTRY_BASE_URL,
    GRAPHDB_BASE_URL: source.GRAPHDB_BASE_URL,
    APP_BASE_PATH: source.APP_BASE_PATH,
    ASSISTANT_MODEL: source.ASSISTANT_MODEL,
    ASSISTANT_API_KEY: source.ASSISTANT_API_KEY,
  });

  return {
    databaseUrl: parsed.DATABASE_URL,
    a2aRegistryBaseUrl: parsed.A2A_REGISTRY_BASE_URL,
    graphDbBaseUrl: parsed.GRAPHDB_BASE_URL,
    appBasePath: getConfiguredAppBasePath({
      APP_BASE_PATH: parsed.APP_BASE_PATH,
    }),
    assistantModel: parsed.ASSISTANT_MODEL,
    assistantApiKey: parsed.ASSISTANT_API_KEY,
  };
}
