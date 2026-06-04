import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";

export function parsePrometheusBaseUrlFromSearchParams(
  searchParams: URLSearchParams,
): { ok: true; url?: string } | { ok: false; error: string } {
  const raw = searchParams.get("prometheusBaseUrl")?.trim();
  if (!raw) {
    return { ok: true, url: undefined };
  }
  return parsePrometheusBaseUrlInput(raw);
}

export async function parsePrometheusBaseUrlFromJsonBody(
  body: Record<string, unknown>,
): Promise<{ ok: true; url?: string } | { ok: false; error: string }> {
  const raw = typeof body.prometheusBaseUrl === "string" ? body.prometheusBaseUrl.trim() : "";
  if (!raw) {
    return { ok: true, url: undefined };
  }
  return parsePrometheusBaseUrlInput(raw);
}
