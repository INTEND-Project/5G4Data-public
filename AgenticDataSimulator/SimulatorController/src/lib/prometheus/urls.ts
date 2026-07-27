export function normalizePrometheusBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Prometheus built-in health endpoint relative to the configured API base URL. */
export function prometheusHealthCheckUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/$/, "");
  return `${root}/-/healthy`;
}

export function normalizePushgatewayBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}
