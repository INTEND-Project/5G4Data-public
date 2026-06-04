import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";
import { normalizePrometheusBaseUrl, prometheusHealthCheckUrl } from "@/lib/prometheus/urls";

function prometheusHealthCheckTargets(baseUrl: string): string[] {
  const targets = [prometheusHealthCheckUrl(baseUrl)];
  const executor = process.env.PROMETHEUS_EXECUTOR_URL?.trim();
  if (executor) {
    targets.push(prometheusHealthCheckUrl(normalizePrometheusBaseUrl(executor)));
  }
  return [...new Set(targets)];
}

export async function getPrometheusConnectionStatus(prometheusBaseUrl?: string | null) {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);

  for (const healthUrl of prometheusHealthCheckTargets(baseUrl)) {
    try {
      const response = await fetch(healthUrl, {
        cache: "no-store",
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // try next target (e.g. public HTTPS via Caddy vs host executor URL)
    }
  }

  return false;
}
