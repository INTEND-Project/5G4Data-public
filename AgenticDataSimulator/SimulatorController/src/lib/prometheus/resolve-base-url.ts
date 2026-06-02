import { z } from "zod";

import { loadAppEnv } from "@/lib/env";
import { normalizePrometheusBaseUrl } from "@/lib/prometheus/urls";

const prometheusBaseUrlSchema = z
  .string()
  .trim()
  .url({ message: "Enter a valid HTTP or HTTPS URL." });

/** Resolve Prometheus API base URL: user override, else server default from env. */
export function resolvePrometheusBaseUrl(override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return normalizePrometheusBaseUrl(prometheusBaseUrlSchema.parse(trimmed));
  }

  const env = loadAppEnv(process.env);
  return normalizePrometheusBaseUrl(env.prometheusUrl);
}

export function parsePrometheusBaseUrlInput(value: string): {
  ok: true;
  url: string;
} | {
  ok: false;
  error: string;
} {
  try {
    return { ok: true, url: resolvePrometheusBaseUrl(value) };
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
