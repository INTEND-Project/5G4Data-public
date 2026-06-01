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
  return `Prometheus observation write failed${metricPart}${samplePart}: ${entry.message}`;
}
