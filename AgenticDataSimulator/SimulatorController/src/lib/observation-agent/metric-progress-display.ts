import type {
  MetricProgressEntry,
  ObservationProgressSnapshot,
} from "@/lib/observation-agent/progress-types";

function computeProgressAggregate(
  metrics: MetricProgressEntry[],
): ObservationProgressSnapshot["aggregate"] {
  let ticksDone = 0;
  let ticksTotal = 0;
  let hasBoundedTotal = false;

  for (const entry of metrics) {
    ticksDone += Math.max(0, entry.ticksDone);
    if (entry.ticksTotal !== null && entry.ticksTotal > 0) {
      hasBoundedTotal = true;
      ticksTotal += entry.ticksTotal;
    }
  }

  if (!hasBoundedTotal) {
    return { ticksDone, ticksTotal: null, percent: null };
  }

  const percent =
    ticksTotal > 0 ? Math.min(100, Math.round((ticksDone / ticksTotal) * 1000) / 10) : null;

  return { ticksDone, ticksTotal, percent };
}

/** Show every expected metric row; merge agent snapshot and preserve completed metrics. */
export function mergeObservationProgressWithExpectedMetrics(
  progress: ObservationProgressSnapshot | null,
  expectedCompoundMetrics: readonly string[],
  intentId: string,
): ObservationProgressSnapshot | null {
  if (expectedCompoundMetrics.length === 0) {
    return progress;
  }

  const progressByMetric = new Map(
    (progress?.metrics ?? []).map((entry) => [entry.compoundMetric, entry]),
  );

  const metrics: MetricProgressEntry[] = expectedCompoundMetrics.map((compoundMetric) => {
    const existing = progressByMetric.get(compoundMetric);
    if (existing) {
      return existing;
    }
    return {
      compoundMetric,
      phase: "pending",
      ticksDone: 0,
      ticksTotal: null,
    };
  });

  for (const entry of progress?.metrics ?? []) {
    if (!expectedCompoundMetrics.includes(entry.compoundMetric)) {
      metrics.push(entry);
    }
  }

  if (!progress) {
    return {
      schemaVersion: "observation_progress_v1",
      updatedAt: new Date(0).toISOString(),
      intentId,
      mode: "historic",
      phase: "codegen",
      codegenMetricsDone: 0,
      codegenMetricsTotal: expectedCompoundMetrics.length,
      metrics,
      aggregate: computeProgressAggregate(metrics),
    };
  }

  return {
    ...progress,
    intentId: progress.intentId || intentId,
    metrics,
    codegenMetricsTotal: Math.max(
      progress.codegenMetricsTotal,
      expectedCompoundMetrics.length,
    ),
    aggregate: progress.metrics.length > 0 ? progress.aggregate : computeProgressAggregate(metrics),
  };
}

export function formatObservationTickCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function metricProgressPercent(entry: MetricProgressEntry): number | null {
  if (entry.phase === "completed") {
    return 100;
  }

  if (entry.ticksTotal !== null && entry.ticksTotal > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((entry.ticksDone / entry.ticksTotal) * 1000) / 10),
    );
  }

  return null;
}

export function metricProgressDetailLabel(entry: MetricProgressEntry): string {
  switch (entry.phase) {
    case "pending":
      return "Waiting…";
    case "codegen":
      return "LLM codegen for sampler…";
    case "generating":
      if (entry.ticksTotal !== null) {
        const percent = metricProgressPercent(entry);
        const percentNote = percent !== null ? ` (${percent}%)` : "";
        return `${formatObservationTickCount(entry.ticksDone)} / ${formatObservationTickCount(entry.ticksTotal)} ticks${percentNote}…`;
      }
      if (entry.ticksDone > 0) {
        return `${formatObservationTickCount(entry.ticksDone)} ticks…`;
      }
      return "Generating…";
    case "flushing":
      return entry.samplesFlushed !== undefined
        ? `Flushing samples (${formatObservationTickCount(entry.samplesFlushed)})…`
        : "Flushing samples…";
    case "completed":
      if (entry.ticksTotal !== null) {
        return `Complete (${formatObservationTickCount(entry.ticksDone)} / ${formatObservationTickCount(entry.ticksTotal)} ticks)`;
      }
      return "Complete";
    case "failed":
      return "Failed";
    default:
      return entry.phase;
  }
}
