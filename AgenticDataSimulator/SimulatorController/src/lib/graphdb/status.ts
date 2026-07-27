import { graphDbAuthHeaders } from "@/lib/graphdb/auth";
import { resolveGraphDbBaseUrl } from "@/lib/graphdb/resolve-base-url";
import { graphDbHealthCheckUrl } from "@/lib/graphdb/urls";

export async function getGraphDbConnectionStatus(graphDbBaseUrl?: string | null) {
  const baseUrl = resolveGraphDbBaseUrl(graphDbBaseUrl);

  try {
    const response = await fetch(graphDbHealthCheckUrl(baseUrl), {
      cache: "no-store",
      headers: graphDbAuthHeaders(),
    });

    return response.ok;
  } catch {
    return false;
  }
}
