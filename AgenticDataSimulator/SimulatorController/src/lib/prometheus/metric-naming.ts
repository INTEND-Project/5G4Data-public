/** Prometheus metric names strip characters illegal in PromQL identifiers. */
export function toPrometheusMetricName(compoundMetric: string): string {
  return compoundMetric.replace(/[^a-zA-Z0-9_]/g, "");
}
