import type { ObservationAgentErrorEntry } from "@/app/api/observation-agent/errors/route";

import type { ObservationSetupError } from "@/lib/observation-agent/metric-progress-display";

/** Error kinds that should mark metrics failed and replace "Waiting…" in the UI. */
export const OBSERVATION_RUNTIME_ERROR_KINDS = new Set([
  "synthetic_setup_failed",
  "repl_hook_failed",
  "synthetic_worker_exit",
  "prometheus_remote_write_flush_failed",
  "prometheus_remote_write_failed",
  "prometheus_unreachable",
]);

function isPrometheusWriteFailure(entry: ObservationAgentErrorEntry): boolean {
  return (
    entry.kind === "prometheus_remote_write_flush_failed" ||
    entry.kind === "prometheus_remote_write_failed" ||
    entry.kind === "prometheus_unreachable" ||
    /prometheus remote write failed/i.test(entry.message) ||
    /fetch failed/i.test(entry.message)
  );
}

export function humanizeObservationAgentError(entry: ObservationAgentErrorEntry): string {
  if (entry.kind === "prometheus_unreachable") {
    return (
      entry.message.trim() ||
      "Prometheus is not reachable from the Controller. Historic observation runs cannot store samples until Prometheus is running (cd Prometheus && ./start.sh)."
    );
  }

  if (isPrometheusWriteFailure(entry)) {
    const samplePart =
      entry.sampleCount !== undefined && entry.sampleCount > 0
        ? ` after generating ${entry.sampleCount.toLocaleString("en-US")} samples`
        : "";
    const urlPart = entry.remoteWriteUrl?.trim()
      ? ` (${entry.remoteWriteUrl.trim()})`
      : "";
    const metricPart = entry.metric ? ` for ${entry.metric}` : "";
    const rootCause = /fetch failed/i.test(entry.message)
      ? "Prometheus was unreachable at flush time"
      : entry.message.trim() || "Prometheus remote write failed";
    return (
      `${rootCause}${metricPart}${samplePart}${urlPart}. ` +
      "Start or restart Prometheus (cd Prometheus && ./start.sh), confirm the Controller Prometheus URL is http://127.0.0.1:9090, then re-run the observation-report step."
    );
  }

  if (entry.kind === "synthetic_worker_exit") {
    const metricPart = entry.metric ? ` for ${entry.metric}` : "";
    if (isPrometheusWriteFailure(entry)) {
      return humanizeObservationAgentError({
        ...entry,
        kind: "prometheus_remote_write_flush_failed",
      });
    }
    return `Synthetic observation worker failed${metricPart}: ${entry.message.trim()}`;
  }

  if (entry.kind === "synthetic_setup_failed") {
    const metricPart = entry.metric ? ` for ${entry.metric}` : "";
    return `Observation setup failed${metricPart}: ${entry.message.trim()}`;
  }

  if (entry.kind === "repl_hook_failed") {
    const metricPart = entry.metric ? ` for ${entry.metric}` : "";
    return `Observation hook failed${metricPart}: ${entry.message.trim()}`;
  }

  const metricPart = entry.metric ? ` for ${entry.metric}` : "";
  return `${entry.kind}${metricPart}: ${entry.message.trim()}`;
}

export function toObservationSetupError(entry: ObservationAgentErrorEntry): ObservationSetupError {
  return {
    kind: entry.kind,
    message: humanizeObservationAgentError(entry),
    metric: entry.metric,
    intentId: entry.intentId,
  };
}

export function isObservationRuntimeError(entry: ObservationSetupError | ObservationAgentErrorEntry): boolean {
  return OBSERVATION_RUNTIME_ERROR_KINDS.has(entry.kind);
}
