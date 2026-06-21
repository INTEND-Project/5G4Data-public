import type { ObservationStorageType } from "@/lib/observation-storage";

export type IntentListEntryLike = {
  intentId: string;
  storage: ObservationStorageType;
  grafanaUrl: string | null;
  dataStatus?: "pending" | "ready";
  metricsReady?: number;
  metricsTotal?: number;
};

function readyMetricsKey(metrics?: readonly string[]): string {
  return metrics?.slice().sort().join("\0") ?? "";
}

export function intentsEqual(left: IntentListEntryLike[], right: IntentListEntryLike[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (intent, index) =>
      intent.intentId === right[index]?.intentId &&
      intent.storage === right[index]?.storage &&
      intent.grafanaUrl === right[index]?.grafanaUrl &&
      (intent.dataStatus ?? "pending") === (right[index]?.dataStatus ?? "pending") &&
      (intent.metricsReady ?? 0) === (right[index]?.metricsReady ?? 0) &&
      (intent.metricsTotal ?? 0) === (right[index]?.metricsTotal ?? 0) &&
      readyMetricsKey(
        (intent as { readyCompoundMetrics?: string[] }).readyCompoundMetrics,
      ) ===
        readyMetricsKey(
          (right[index] as { readyCompoundMetrics?: string[] } | undefined)
            ?.readyCompoundMetrics,
        ),
  );
}
