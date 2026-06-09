"use client";

import type {
  MetricProgressEntry,
  ObservationProgressSnapshot,
} from "@/lib/observation-agent/progress-types";
import {
  detectStuckPendingMetrics,
  formatObservationTickCount,
  metricProgressDetailLabel,
  metricProgressPercent,
  type ObservationSetupError,
} from "@/lib/observation-agent/metric-progress-display";

export type ObservationProgressBarProps = {
  progress: ObservationProgressSnapshot | null;
  intentId?: string | null;
  compact?: boolean;
  /** Historic run registered but agent has not returned a snapshot yet. */
  waitingForAgent?: boolean;
  expectedCompoundMetrics?: readonly string[];
  setupErrors?: readonly ObservationSetupError[];
  awaitingSinceMs?: number;
  rawAgentProgress?: ObservationProgressSnapshot | null;
};

function intentSummaryLabel(progress: ObservationProgressSnapshot): string {
  const { aggregate, phase, codegenMetricsDone, codegenMetricsTotal, metrics } = progress;

  if (phase === "codegen") {
    return `LLM codegen (${codegenMetricsDone}/${codegenMetricsTotal} metrics)…`;
  }

  if (phase === "failed") {
    return "One or more metrics failed.";
  }

  if (phase === "completed") {
    if (aggregate.ticksTotal !== null) {
      return `All metrics complete (${formatObservationTickCount(aggregate.ticksDone)} / ${formatObservationTickCount(aggregate.ticksTotal)} ticks total).`;
    }
    return "All metrics complete.";
  }

  const activeCount = metrics.filter(
    (m) => m.phase !== "pending" && m.phase !== "completed",
  ).length;

  if (aggregate.ticksTotal !== null) {
    const percent = aggregate.percent !== null ? ` — ${aggregate.percent}% overall` : "";
    return `${metrics.length} metrics (${activeCount} active)${percent}`;
  }

  return `${metrics.length} metrics (${activeCount} active)…`;
}

function MetricProgressRow({
  entry,
  compact,
  stuckPendingHint,
}: {
  entry: MetricProgressEntry;
  compact: boolean;
  stuckPendingHint?: string | null;
}) {
  const percent = metricProgressPercent(entry);
  const indeterminate =
    percent === null && entry.phase !== "completed" && entry.phase !== "failed";
  const detailLabel = metricProgressDetailLabel(entry, stuckPendingHint);

  return (
    <div
      className={
        compact
          ? "workspace-observation-progress-metric-row workspace-observation-progress-metric-row--compact"
          : "workspace-observation-progress-metric-row"
      }
    >
      <div className="workspace-observation-progress-metric-row-header">
        <span className="workspace-observation-progress-metric-name" title={entry.compoundMetric}>
          {entry.compoundMetric}
        </span>
        <span className="workspace-observation-progress-metric-detail">
          {detailLabel}
        </span>
      </div>
      <progress
        aria-label={`${entry.compoundMetric}: ${detailLabel}`}
        aria-valuemax={percent !== null ? 100 : undefined}
        aria-valuemin={0}
        aria-valuenow={percent ?? undefined}
        className="workspace-observation-progress-meter workspace-observation-progress-meter--metric"
        max={percent !== null ? 100 : undefined}
        value={percent !== null ? percent : undefined}
      />
      {indeterminate && !compact ? (
        <p className="workspace-hint workspace-observation-progress-indeterminate workspace-observation-progress-indeterminate--metric">
          Tick total not available yet for this metric.
        </p>
      ) : null}
    </div>
  );
}

export function ObservationProgressBar({
  progress,
  intentId,
  compact = false,
  waitingForAgent = false,
  expectedCompoundMetrics = [],
  setupErrors = [],
  awaitingSinceMs,
  rawAgentProgress = null,
}: ObservationProgressBarProps) {
  const rootClass = compact
    ? "workspace-observation-progress workspace-observation-progress--compact"
    : "workspace-observation-progress";

  const stuckPendingHint = detectStuckPendingMetrics(
    progress,
    expectedCompoundMetrics,
    setupErrors,
    { awaitingSinceMs, rawAgentProgress },
  );

  if (!progress) {
    if (!waitingForAgent) {
      return null;
    }
    return (
      <div className={rootClass}>
        <div className="workspace-observation-progress-heading">
          <strong>Observation generation</strong>
          {intentId ? (
            <span className="workspace-observation-progress-intent">{intentId}</span>
          ) : null}
        </div>
        {stuckPendingHint ? (
          <p className="workspace-save-error" role="alert">
            {stuckPendingHint}
          </p>
        ) : (
          <p className="workspace-observation-progress-label">
            Waiting for tick progress from the observation agent…
          </p>
        )}
        <progress className="workspace-observation-progress-meter" />
        {!stuckPendingHint ? (
          <p className="workspace-hint workspace-observation-progress-indeterminate">
            Progress appears once the agent starts historic synthetic generation. If this never
            updates, set OBSERVATION_AGENT_CONTROL_BASE_URL on the Controller to the agent kernel API
            (e.g. http://127.0.0.1:3012/v1) when the public agent URL does not expose
            observation-progress.
          </p>
        ) : null}
      </div>
    );
  }

  const metrics = progress.metrics;
  const alertMessage =
    progress.phase === "failed"
      ? metrics.find((entry) => entry.phase === "failed" && entry.errorMessage)?.errorMessage ??
        stuckPendingHint
      : stuckPendingHint;

  return (
    <div className={rootClass}>
      <div className="workspace-observation-progress-heading">
        <strong>Observation generation</strong>
        {intentId ? (
          <span className="workspace-observation-progress-intent">{intentId}</span>
        ) : null}
      </div>
      {alertMessage ? (
        <p className="workspace-save-error" role="alert">
          {alertMessage}
        </p>
      ) : null}
      {metrics.length > 0 ? (
        <>
          <p className="workspace-observation-progress-label">{intentSummaryLabel(progress)}</p>
          <div className="workspace-observation-progress-metric-bars">
            {metrics.map((entry) => (
              <MetricProgressRow
                compact={compact}
                entry={entry}
                key={entry.compoundMetric}
                stuckPendingHint={stuckPendingHint}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="workspace-observation-progress-label">{intentSummaryLabel(progress)}</p>
          <progress className="workspace-observation-progress-meter" />
        </>
      )}
    </div>
  );
}
