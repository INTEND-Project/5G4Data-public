import { toPrometheusMetricName } from "@/lib/prometheus/metric-naming";

export interface PrometheusSeriesIdentity {
  compoundMetric: string;
  intentId: string;
  conditionId?: string | null;
}

function escapePrometheusLabelValue(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildPrometheusLabelSelector(labels: Record<string, string>): string {
  const pairs = Object.entries(labels)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}="${escapePrometheusLabelValue(v)}"`);
  return pairs.length > 0 ? `{${pairs.join(",")}}` : "";
}

function prometheusSeriesLabels(identity: PrometheusSeriesIdentity): Record<string, string> {
  const labels: Record<string, string> = {
    intent_id: identity.intentId,
  };
  if (identity.conditionId) {
    labels.condition_id = identity.conditionId;
  }
  return labels;
}

function prometheusQueryLabels(identity: PrometheusSeriesIdentity): Record<string, string> {
  return { job: "intent_reports", ...prometheusSeriesLabels(identity) };
}

export function buildPrometheusReadableQuery(identity: PrometheusSeriesIdentity): string {
  const metric = toPrometheusMetricName(identity.compoundMetric);
  return `${metric}${buildPrometheusLabelSelector(prometheusQueryLabels(identity))}`;
}

export function buildPrometheusInstantQueryUrl(
  prometheusBaseUrl: string,
  identity: PrometheusSeriesIdentity,
): string {
  const readable = buildPrometheusReadableQuery(identity);
  const base = prometheusBaseUrl.replace(/\/$/, "");
  return `${base}/api/v1/query?query=${encodeURIComponent(readable)}`;
}
