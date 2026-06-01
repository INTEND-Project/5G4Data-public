import { loadAppEnv } from "@/lib/env";

/** HTTP Basic auth headers when `GRAPHDB_USERNAME` and `GRAPHDB_PASSWORD` are set. */
export function graphDbAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const env = loadAppEnv(process.env);
  const headers = { ...extra };
  if (!env.graphDbUsername || !env.graphDbPassword) {
    return headers;
  }
  const encoded = Buffer.from(
    `${env.graphDbUsername}:${env.graphDbPassword}`,
    "utf8",
  ).toString("base64");
  headers.Authorization = `Basic ${encoded}`;
  return headers;
}
