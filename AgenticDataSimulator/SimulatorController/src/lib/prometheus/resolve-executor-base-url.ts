import { z } from "zod";

import { normalizePrometheusBaseUrl } from "@/lib/prometheus/urls";

const prometheusExecutorUrlSchema = z
  .string()
  .trim()
  .url({ message: "Enter a valid HTTP or HTTPS URL." });

/**
 * Prometheus API base used in GraphDB `hasQuery` metadata and by IntentReportQueryProxy
 * on the same host as Prometheus. Not the public HTTPS URL from the Controller UI.
 */
export function resolvePrometheusExecutorBaseUrl(): string {
  const raw = process.env.PROMETHEUS_EXECUTOR_URL?.trim();
  if (raw) {
    return normalizePrometheusBaseUrl(prometheusExecutorUrlSchema.parse(raw));
  }
  return normalizePrometheusBaseUrl("http://127.0.0.1:9090");
}
