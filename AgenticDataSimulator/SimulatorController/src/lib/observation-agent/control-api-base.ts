/**
 * Base URL for observation control GET routes (progress, errors).
 * Prefer OBSERVATION_AGENT_CONTROL_BASE_URL when the public A2A card URL does not
 * route those paths (common with path-prefix reverse proxies).
 */
export function resolveObservationControlApiBase(
  rpcUrl: string,
  controlBaseOverride?: string | null,
): string {
  const override = controlBaseOverride?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }

  const trimmed = rpcUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed;
  }
  return `${trimmed}/v1`;
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
