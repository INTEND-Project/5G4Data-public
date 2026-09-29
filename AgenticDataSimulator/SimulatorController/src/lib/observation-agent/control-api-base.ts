/**
 * Base URL for observation control GET routes (progress, errors).
 *
 * Prefer the discovered agent's A2A card `url` (rpcUrl) so the X-Api-Key matches
 * that agent. A bare localhost override (e.g. `http://127.0.0.1:3012/v1`) is ignored
 * when the card URL is a different host — otherwise progress polls hit the wrong
 * agent after switching preferred observation agents (classic 401).
 *
 * Overrides that include an agent path slug, or same-host rewrites, still apply when
 * the public card path does not expose observation-progress.
 */
export function resolveObservationControlApiBase(
  rpcUrl: string,
  controlBaseOverride?: string | null,
): string {
  const trimmed = rpcUrl.trim().replace(/\/+$/, "");
  const derived = trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;

  const override = controlBaseOverride?.trim();
  if (!override) {
    return derived;
  }

  const normalizedOverride = override.replace(/\/+$/, "");
  try {
    const overrideUrl = new URL(normalizedOverride);
    const rpc = new URL(trimmed.startsWith("http") ? trimmed : `https://invalid.local${trimmed.startsWith("/") ? "" : "/"}${trimmed}`);
    const overrideSegments = overrideUrl.pathname.split("/").filter(Boolean);
    // `http://127.0.0.1:3012/v1` → segments ["v1"] — no agent slug.
    const overrideHasAgentSlug = overrideSegments.some((s) => s !== "v1");
    const overrideIsLoopback =
      overrideUrl.hostname === "127.0.0.1" || overrideUrl.hostname === "localhost";
    const rpcIsLoopback = rpc.hostname === "127.0.0.1" || rpc.hostname === "localhost";
    if (overrideIsLoopback && !overrideHasAgentSlug && !rpcIsLoopback) {
      return derived;
    }
  } catch {
    // Fall through to override if URL parsing fails.
  }

  return normalizedOverride;
}

export function observationProgressUrl(
  rpcUrl: string,
  controlBaseOverride?: string | null,
): string {
  const base = resolveObservationControlApiBase(rpcUrl, controlBaseOverride);
  return `${base}/observation-progress`;
}

export function observationErrorsUrl(
  rpcUrl: string,
  controlBaseOverride?: string | null,
): string {
  const base = resolveObservationControlApiBase(rpcUrl, controlBaseOverride);
  return `${base}/observation-errors`;
}
