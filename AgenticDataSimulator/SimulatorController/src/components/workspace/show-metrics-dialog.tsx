"use client";

import type {
  WorkloadMetricEntry,
  WorkloadPreviewMetrics,
} from "@/lib/workload-catalogue/preview-metrics-client";

function trimmedField(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function formatMetricLine(metric: WorkloadMetricEntry): string {
  const name = String(metric.name ?? "<unnamed>").trim();
  const valueHint = metric["tmf-value-hint"];
  const threshold =
    valueHint !== undefined && String(valueHint).trim() !== ""
      ? String(valueHint).trim()
      : String(metric.value ?? "unspecified");
  const parts = [`${name}: threshold=${threshold}`];

  const quantifierHint = trimmedField(metric["tmf-quantifier-hint"]);
  if (quantifierHint) {
    parts.push(`quantifier=${quantifierHint}`);
  }

  const unitHint = trimmedField(metric["tmf-unit-hint"]);
  if (unitHint) {
    parts.push(`unit=${unitHint}`);
  }

  const measuredBy = trimmedField(metric.measuredBy);
  if (measuredBy) {
    parts.push(`measuredBy=${measuredBy}`);
  }

  return parts.join(", ");
}

function MetricSection({
  title,
  metrics,
}: {
  title: string;
  metrics: WorkloadMetricEntry[];
}) {
  if (metrics.length === 0) {
    return (
      <section className="workspace-show-metrics-section">
        <h4>{title}</h4>
        <p className="workspace-show-metrics-empty">(none)</p>
      </section>
    );
  }

  return (
    <section className="workspace-show-metrics-section">
      <h4>{title}</h4>
      <ul className="workspace-show-metrics-list">
        {metrics.map((metric, index) => (
          <li key={`${String(metric.name ?? index)}-${index}`}>
            <code>{formatMetricLine(metric)}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type ShowMetricsDialogProps = {
  open: boolean;
  promptPreview: string;
  preview: WorkloadPreviewMetrics | null;
  onClose: () => void;
};

export function ShowMetricsDialog({
  open,
  promptPreview,
  preview,
  onClose,
}: ShowMetricsDialogProps) {
  if (!open || !preview) {
    return null;
  }

  const workloadLabel = preview.selectedChart
    ? `${preview.selectedChart}${preview.version ? ` (version ${preview.version})` : ""}`
    : "No matching workload found in catalogue";

  return (
    <div
      className="workspace-save-name-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby="workspace-show-metrics-dialog-title"
        aria-modal="true"
        className="workspace-save-name-dialog workspace-show-metrics-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="workspace-show-metrics-dialog-title">Workload metrics preview</h3>
        <p className="workspace-save-as-dialog-hint">
          Catalogue metrics for the workload the intent agent would select for this prompt
          (intent is not created).
        </p>
        <p className="workspace-show-metrics-prompt">
          <span className="workspace-label">Prompt</span>
          <em>{promptPreview}</em>
        </p>
        <p className="workspace-show-metrics-workload">
          <span className="workspace-label">Selected workload</span>
          <strong>{workloadLabel}</strong>
        </p>

        {preview.warnings.length > 0 ? (
          <ul className="workspace-show-metrics-warnings" role="alert">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        {preview.metricStems.length > 0 ? (
          <section className="workspace-show-metrics-section">
            <h4>Metric stems (for observation-report)</h4>
            <p className="workspace-show-metrics-stems">
              <code>{preview.metricStems.join(", ")}</code>
            </p>
          </section>
        ) : null}

        <MetricSection title="Deployment objectives" metrics={preview.objectives} />
        <MetricSection title="Sustainability metrics" metrics={preview.sustainability} />

        <div className="workspace-save-name-dialog-actions">
          <button className="workspace-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
