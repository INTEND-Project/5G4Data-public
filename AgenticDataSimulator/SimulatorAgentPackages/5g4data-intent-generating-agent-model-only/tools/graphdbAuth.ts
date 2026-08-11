/** HTTP Basic auth for GraphDB when `GRAPHDB_USERNAME` and `GRAPHDB_PASSWORD` are set. */
export function graphDbAuthHeaders(
  extra: Record<string, string> = {}
): Record<string, string> {
  const user = process.env.GRAPHDB_USERNAME?.trim();
  const pass = process.env.GRAPHDB_PASSWORD;
  const headers = { ...extra };
  if (!user || !pass) {
    return headers;
  }
  const encoded = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  headers.Authorization = `Basic ${encoded}`;
  return headers;
}
