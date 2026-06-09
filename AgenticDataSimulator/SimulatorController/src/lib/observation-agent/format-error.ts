import type { ObservationAgentErrorEntry } from "@/app/api/observation-agent/errors/route";

export function observationAgentErrorKey(entry: ObservationAgentErrorEntry): string {
  return `${entry.timestampUtc}|${entry.kind}|${entry.metric ?? ""}|${entry.message}`;
}

export function formatObservationAgentErrorMessage(entry: ObservationAgentErrorEntry): string {
  const metricPart = entry.metric ? ` for ${entry.metric}` : "";
  const samplePart =
    entry.sampleCount !== undefined && entry.sampleCount > 0
      ? ` (${entry.sampleCount} sample${entry.sampleCount === 1 ? "" : "s"})`
      : "";

  if (entry.kind === "repl_hook_failed") {
    return `Observation hook failed${metricPart}: ${entry.message}`;
  }

  if (entry.kind === "synthetic_setup_failed") {
    return `Observation setup failed${metricPart}: ${entry.message}`;
  }

  if (entry.kind === "synthetic_worker_exit") {
    return `Synthetic observation worker failed${metricPart}${samplePart}: ${entry.message}`;
  }

  return `Prometheus observation write failed${metricPart}${samplePart}: ${entry.message}`;
}
