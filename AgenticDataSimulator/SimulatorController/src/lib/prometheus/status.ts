import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";
import { prometheusHealthCheckUrl } from "@/lib/prometheus/urls";

export async function getPrometheusConnectionStatus(prometheusBaseUrl?: string | null) {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);

  try {
    const response = await fetch(prometheusHealthCheckUrl(baseUrl), {
      cache: "no-store",
    });

    return response.ok;
  } catch {
    return false;
  }
}
