import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";
import { normalizePrometheusBaseUrl, prometheusHealthCheckUrl } from "@/lib/prometheus/urls";

function prometheusHealthCheckTargets(
  baseUrl: string,
  overrideProvided: boolean,
): string[] {
  const targets = [prometheusHealthCheckUrl(baseUrl)];
  if (!overrideProvided) {
    const executor = process.env.PROMETHEUS_EXECUTOR_URL?.trim();
    if (executor) {
      targets.push(prometheusHealthCheckUrl(normalizePrometheusBaseUrl(executor)));
    }
  }
  return [...new Set(targets)];
}

export async function getPrometheusConnectionStatus(prometheusBaseUrl?: string | null) {
  const overrideProvided = Boolean(prometheusBaseUrl?.trim());
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);

  for (const healthUrl of prometheusHealthCheckTargets(baseUrl, overrideProvided)) {
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
