const STORAGE_PREFIX = "simulator-controller:script-observation-metrics:";

export function scriptObservationMetricsStorageKey(domain: string): string {
  return `${STORAGE_PREFIX}${domain.trim()}`;
}

export function readScriptObservationMetrics(
  domain: string,
): Record<string, string[]> {
  if (typeof window === "undefined" || !domain.trim()) {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(scriptObservationMetricsStorageKey(domain));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function writeScriptObservationMetrics(
  domain: string,
  metricsByIntentId: Record<string, readonly string[]>,
): void {
  if (typeof window === "undefined" || !domain.trim()) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      scriptObservationMetricsStorageKey(domain),
      JSON.stringify(metricsByIntentId),
    );
  } catch {
    /* ignore quota / privacy mode */
  }
}

export function clearScriptObservationMetrics(domain: string): void {
  if (typeof window === "undefined" || !domain.trim()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(scriptObservationMetricsStorageKey(domain));
  } catch {
    /* ignore */
  }
}
