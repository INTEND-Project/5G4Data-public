import type {
  MetricProgressEntry,
  ObservationProgressSnapshot,
} from "@/lib/observation-agent/progress-types";

export type ObservationSetupError = {
  kind: string;
  message: string;
  metric?: string;
  intentId?: string;
};

export const STUCK_PENDING_MS = 60_000;
export const SYNTHETIC_OBSERVATION_PROGRESS_EPOCH_MS = 0;
const ERROR_LABEL_MAX = 80;

const SETUP_FAILURE_KINDS = new Set(["synthetic_setup_failed", "repl_hook_failed"]);

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

function truncateErrorMessage(message: string, max = ERROR_LABEL_MAX): string {
  const trimmed = message.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function metricMatchesExpectedCompound(metricRef: string, expectedCompound: string): boolean {
  const ref = metricRef.trim();
  const expected = expectedCompound.trim();
  if (!ref || !expected) {
    return false;
  }
  if (ref === expected) {
    return true;
  }
  if (expected.startsWith(`${ref}_CO`)) {
    return true;
  }
  if (ref.startsWith(`${expected}_CO`)) {
    return true;
  }
  return false;
}

function errorMatchesExpectedMetric(error: ObservationSetupError, expectedCompound: string): boolean {
  if (!error.metric) {
    return false;
  }
  return metricMatchesExpectedCompound(error.metric, expectedCompound);
}

function findSetupErrorForMetric(
  entry: MetricProgressEntry,
  expectedCompoundMetrics: readonly string[],
  setupErrors: readonly ObservationSetupError[],
  intentId: string,
): ObservationSetupError | undefined {
  const perMetric = setupErrors.find(
    (error) =>
      SETUP_FAILURE_KINDS.has(error.kind) &&
      error.metric &&
      (errorMatchesExpectedMetric(error, entry.compoundMetric) ||
        expectedCompoundMetrics.some(
          (expected) =>
            expected === entry.compoundMetric && errorMatchesExpectedMetric(error, expected),
        )),
  );
  if (perMetric) {
    return perMetric;
  }

  return setupErrors.find(
    (error) =>
      SETUP_FAILURE_KINDS.has(error.kind) &&
      !error.metric?.trim() &&
      (!error.intentId?.trim() || error.intentId === intentId),
  );
}

function applySetupErrorsToMetrics(
  metrics: MetricProgressEntry[],
  expectedCompoundMetrics: readonly string[],
  setupErrors: readonly ObservationSetupError[],
  intentId: string,
): MetricProgressEntry[] {
  if (setupErrors.length === 0) {
    return metrics;
  }

  return metrics.map((entry) => {
    const matchingError = findSetupErrorForMetric(
      entry,
      expectedCompoundMetrics,
      setupErrors,
      intentId,
    );
    if (!matchingError) {
      return entry;
    }
    return {
      ...entry,
      phase: "failed",
      errorMessage: matchingError.message,
    };
  });
}

/** Show every expected metric row; merge agent snapshot and preserve completed metrics. */
export function mergeObservationProgressWithExpectedMetrics(
  progress: ObservationProgressSnapshot | null,
  expectedCompoundMetrics: readonly string[],
  intentId: string,
  setupErrors: readonly ObservationSetupError[] = [],
): ObservationProgressSnapshot | null {
  if (expectedCompoundMetrics.length === 0) {
    return progress;
  }

  const progressByMetric = new Map(
    (progress?.metrics ?? []).map((entry) => [entry.compoundMetric, entry]),
  );

  let metrics: MetricProgressEntry[] = expectedCompoundMetrics.map((compoundMetric) => {
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

  metrics = applySetupErrorsToMetrics(metrics, expectedCompoundMetrics, setupErrors, intentId);

  const hasFailed = metrics.some((entry) => entry.phase === "failed");
  const baseProgress: ObservationProgressSnapshot = progress ?? {
    schemaVersion: "observation_progress_v1",
    updatedAt: new Date(SYNTHETIC_OBSERVATION_PROGRESS_EPOCH_MS).toISOString(),
    intentId,
    mode: "historic",
    phase: "codegen",
    codegenMetricsDone: 0,
    codegenMetricsTotal: expectedCompoundMetrics.length,
    metrics,
    aggregate: computeProgressAggregate(metrics),
  };

  return {
    ...baseProgress,
    intentId: baseProgress.intentId || intentId,
    metrics,
    phase: hasFailed ? "failed" : baseProgress.phase,
    codegenMetricsTotal: Math.max(
      baseProgress.codegenMetricsTotal,
      expectedCompoundMetrics.length,
    ),
    aggregate:
      baseProgress.metrics.length > 0 ? baseProgress.aggregate : computeProgressAggregate(metrics),
  };
}

export type DetectStuckPendingOptions = {
  /** When the Controller started waiting for this intent (e.g. seed sent / historic line executed). */
  awaitingSinceMs?: number;
  /** Unmerged progress snapshot returned by the observation agent poll, if any. */
  rawAgentProgress?: ObservationProgressSnapshot | null;
};

function hasExceededStuckPendingThreshold(
  awaitingSinceMs: number | undefined,
  progressUpdatedAtMs: number | undefined,
): boolean {
  const now = Date.now();
  if (awaitingSinceMs !== undefined && now - awaitingSinceMs >= STUCK_PENDING_MS) {
    return true;
  }
  if (
    progressUpdatedAtMs !== undefined &&
    Number.isFinite(progressUpdatedAtMs) &&
    progressUpdatedAtMs > SYNTHETIC_OBSERVATION_PROGRESS_EPOCH_MS &&
    now - progressUpdatedAtMs >= STUCK_PENDING_MS
  ) {
    return true;
  }
  return false;
}

export function detectStuckPendingMetrics(
  progress: ObservationProgressSnapshot | null,
  expectedCompoundMetrics: readonly string[],
  setupErrors: readonly ObservationSetupError[] = [],
  options: DetectStuckPendingOptions = {},
): string | null {
  if (expectedCompoundMetrics.length === 0) {
    return null;
  }

  const setupFailure = setupErrors.find(
    (error) => SETUP_FAILURE_KINDS.has(error.kind) && error.message.trim(),
  );
  if (setupFailure?.message) {
    return truncateErrorMessage(setupFailure.message);
  }

  const allPending = expectedCompoundMetrics.every((expected) => {
    const entry = progress?.metrics.find(
      (metric) =>
        metric.compoundMetric === expected ||
        metricMatchesExpectedCompound(expected, metric.compoundMetric),
    );
    return !entry || entry.phase === "pending";
  });

  if (!allPending) {
    return null;
  }

  const rawAgentProgress = options.rawAgentProgress ?? null;
  const progressUpdatedAtMs = rawAgentProgress?.updatedAt
    ? Date.parse(rawAgentProgress.updatedAt)
    : progress?.updatedAt
      ? Date.parse(progress.updatedAt)
      : undefined;

  if (
    !hasExceededStuckPendingThreshold(options.awaitingSinceMs, progressUpdatedAtMs)
  ) {
    return null;
  }

  return "Observation agent has not started metric workers. Check the run log for setup errors.";
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

export function metricProgressDetailLabel(
  entry: MetricProgressEntry,
  stuckPendingHint?: string | null,
): string {
  switch (entry.phase) {
    case "pending":
      return stuckPendingHint
        ? truncateErrorMessage(stuckPendingHint)
        : "Waiting…";
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
      return entry.errorMessage
        ? truncateErrorMessage(entry.errorMessage)
        : "Failed";
    default:
      return entry.phase;
  }
}
