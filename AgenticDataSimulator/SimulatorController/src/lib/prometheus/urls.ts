export function normalizePrometheusBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function normalizePushgatewayBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}
