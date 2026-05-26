import { loadAppEnv } from "@/lib/env";
import { normalizePrometheusBaseUrl } from "@/lib/prometheus/urls";

export async function getPrometheusConnectionStatus() {
  const env = loadAppEnv(process.env);
  const baseUrl = normalizePrometheusBaseUrl(env.prometheusUrl);

  try {
    const response = await fetch(`${baseUrl}-/healthy`, {
      cache: "no-store",
    });

    return response.ok;
  } catch {
    return false;
  }
}
