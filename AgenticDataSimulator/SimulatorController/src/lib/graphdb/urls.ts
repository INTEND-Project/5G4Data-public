export function normalizeGraphDbBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** GraphDB REST repositories listing used as a lightweight reachability probe. */
export function graphDbHealthCheckUrl(baseUrl: string): string {
  return `${normalizeGraphDbBaseUrl(baseUrl)}rest/repositories`;
}
