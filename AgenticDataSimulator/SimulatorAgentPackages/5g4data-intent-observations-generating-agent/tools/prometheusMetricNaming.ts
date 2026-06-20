/**
 * Prometheus exposition names must match `[a-zA-Z_:][a-zA-Z0-9_:]*`.
 * Intent/GraphDB compound metrics (e.g. `p99-token-target_CO…`) keep hyphens in Turtle
 * and in GraphDB metadata subjects; Pushgateway/PromQL use a sanitized form aligned with
 * IntentReport-Simulator (`prometheus_client._format_metric`).
 */

export interface PrometheusSeriesIdentity {
  compoundMetric: string;
  intentId: string;
  conditionId?: string | null;
}

/** Strip characters illegal in Prometheus metric names (keep letters, digits, underscore). */
export function toPrometheusMetricName(compoundMetric: string): string {
  return compoundMetric.replace(/[^a-zA-Z0-9_]/g, "");
}

function escapePrometheusLabelValue(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** PromQL label selector for a pushed intent observation series. */
export function buildPrometheusLabelSelector(labels: Record<string, string>): string {
  const pairs = Object.entries(labels)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}="${escapePrometheusLabelValue(v)}"`);
  return pairs.length > 0 ? `{${pairs.join(",")}}` : "";
}

export function prometheusSeriesLabels(identity: PrometheusSeriesIdentity): Record<string, string> {
  const labels: Record<string, string> = {
    intent_id: identity.intentId
  };
  if (identity.conditionId) {
    labels.condition_id = identity.conditionId;
  }
  return labels;
}

/** Labels as they appear in PromQL after Pushgateway scrape (includes `job`). */
export function prometheusQueryLabels(identity: PrometheusSeriesIdentity): Record<string, string> {
  return { job: "intent_reports", ...prometheusSeriesLabels(identity) };
}

/** Human-readable PromQL used in GraphDB `data5g:hasReadableQuery`. */
export function buildPrometheusReadableQuery(identity: PrometheusSeriesIdentity): string {
  const metric = toPrometheusMetricName(identity.compoundMetric);
  return `${metric}${buildPrometheusLabelSelector(prometheusQueryLabels(identity))}`;
}

export function buildPrometheusInstantQueryUrl(
  prometheusBaseUrl: string,
  identity: PrometheusSeriesIdentity
): string {
  const readable = buildPrometheusReadableQuery(identity);
  const base = resolvePrometheusMetadataBaseUrl(prometheusBaseUrl).replace(/\/$/, "");
  return `${base}/api/v1/query?query=${encodeURIComponent(readable)}`;
}

/** Base URL embedded in GraphDB `hasQuery` (reachable from IntentReportQueryProxy on the host). */
export function resolvePrometheusMetadataBaseUrl(explicit?: string | null): string {
  const raw =
    explicit?.trim() ||
    process.env.PROMETHEUS_EXECUTOR_URL?.trim() ||
    process.env.PROMETHEUS_URL?.trim() ||
    "http://127.0.0.1:9090/prometheus";
  let base = raw.replace(/\/$/, "");
  if (/^https?:\/\/(127\.0\.0\.1|localhost):9090$/i.test(base)) {
    base = `${base}/prometheus`;
  }
  return base.endsWith("/") ? base : `${base}/`;
}
