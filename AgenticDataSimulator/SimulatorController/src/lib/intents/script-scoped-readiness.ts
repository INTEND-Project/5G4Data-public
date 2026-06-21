import { metricMatchesExpectedCompound } from "@/lib/observation-agent/metric-progress-display";
import type { IntentDataStatus } from "@/lib/intents/intent-data-readiness";
import type { ObservationProgressSnapshot } from "@/lib/observation-agent/progress-types";

export type IntentReadinessCounts = {
  metricsReady: number;
  metricsTotal: number;
  dataStatus: IntentDataStatus;
};

function scriptMetricIsReady(
  requested: string,
  readyCompoundMetrics: readonly string[],
): boolean {
  return readyCompoundMetrics.some(
    (ready) =>
      metricMatchesExpectedCompound(requested, ready) ||
      metricMatchesExpectedCompound(ready, requested),
  );
}

/** When a script requested a subset of metrics, scope readiness to that subset. */
export function applyScriptRequestedMetricsScope(
  api: IntentReadinessCounts,
  scriptRequestedMetrics?: readonly string[],
  readyCompoundMetrics?: readonly string[],
): IntentReadinessCounts {
  if (!scriptRequestedMetrics?.length) {
    return api;
  }

  const total = scriptRequestedMetrics.length;
  const readyList = readyCompoundMetrics ?? [];
  let ready = 0;
  for (const requested of scriptRequestedMetrics) {
    if (scriptMetricIsReady(requested, readyList)) {
      ready += 1;
    }
  }

  const dataStatus: IntentDataStatus = ready >= total ? "ready" : "pending";
  return { metricsReady: ready, metricsTotal: total, dataStatus };
}

export function observationProgressCoversScriptMetrics(
  progress: ObservationProgressSnapshot | null | undefined,
  scriptRequestedMetrics: readonly string[],
): boolean {
  if (!progress || scriptRequestedMetrics.length === 0) {
    return false;
  }

  return scriptRequestedMetrics.every((requested) =>
    progress.metrics.some(
      (entry) =>
        entry.phase === "completed" &&
        metricMatchesExpectedCompound(requested, entry.compoundMetric),
    ),
  );
}

export function resolveScriptScopedReadiness(
  api: IntentReadinessCounts,
  scriptRequestedMetrics?: readonly string[],
  readyCompoundMetrics?: readonly string[],
  observationProgress?: ObservationProgressSnapshot | null,
): IntentReadinessCounts {
  const scoped = applyScriptRequestedMetricsScope(
    api,
    scriptRequestedMetrics,
    readyCompoundMetrics,
  );

  if (
    scoped.dataStatus === "ready" ||
    !scriptRequestedMetrics?.length ||
    !observationProgressCoversScriptMetrics(observationProgress, scriptRequestedMetrics)
  ) {
    return scoped;
  }

  return {
    metricsReady: scriptRequestedMetrics.length,
    metricsTotal: scriptRequestedMetrics.length,
    dataStatus: "ready",
  };
}
