import { graphDbAuthHeaders } from "@/lib/graphdb/auth";
import { loadAppEnv } from "@/lib/env";

export async function getGraphDbConnectionStatus() {
  const env = loadAppEnv(process.env);
  const baseUrl = env.graphDbBaseUrl.endsWith("/")
    ? env.graphDbBaseUrl
    : `${env.graphDbBaseUrl}/`;

  try {
    const response = await fetch(`${baseUrl}rest/repositories`, {
      cache: "no-store",
      headers: graphDbAuthHeaders(),
    });

    return response.ok;
  } catch {
    return false;
  }
}
