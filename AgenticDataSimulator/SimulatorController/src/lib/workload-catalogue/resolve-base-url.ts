import { z } from "zod";

import { loadAppEnv } from "@/lib/env";

const workloadCatalogBaseUrlSchema = z
  .string()
  .trim()
  .url({ message: "Enter a valid HTTP or HTTPS URL." });

export function normalizeWorkloadCatalogBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

/** Resolve workload catalogue base URL: user override, else server default from env. */
export function resolveWorkloadCatalogBaseUrl(override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return normalizeWorkloadCatalogBaseUrl(workloadCatalogBaseUrlSchema.parse(trimmed));
  }

  const env = loadAppEnv(process.env);
  return normalizeWorkloadCatalogBaseUrl(env.workloadCatalogBaseUrl);
}

export function parseWorkloadCatalogBaseUrlInput(value: string): {
  ok: true;
  url: string;
} | {
  ok: false;
  error: string;
} {
  try {
    return { ok: true, url: resolveWorkloadCatalogBaseUrl(value) };
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid URL.")
        : error instanceof Error
          ? error.message
          : "Invalid URL.";
    return { ok: false, error: message };
  }
}
