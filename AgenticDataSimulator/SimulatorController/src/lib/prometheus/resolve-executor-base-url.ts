import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";

/**
 * Prometheus API base for GraphDB `hasQuery` metadata and IntentReportQueryProxy.
 * Uses workspace override when provided; otherwise PROMETHEUS_EXECUTOR_URL or PROMETHEUS_URL.
 */
export function resolvePrometheusExecutorBaseUrl(prometheusBaseUrl?: string | null): string {
  const override = prometheusBaseUrl?.trim();
  if (override) {
    return resolvePrometheusBaseUrl(override);
  }

  const fromExecutor = process.env.PROMETHEUS_EXECUTOR_URL?.trim();
  if (fromExecutor) {
    return resolvePrometheusBaseUrl(fromExecutor);
  }

  return resolvePrometheusBaseUrl();
}
