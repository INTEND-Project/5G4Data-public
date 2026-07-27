import type { ObservationAgentErrorEntry } from "@/app/api/observation-agent/errors/route";
import { humanizeObservationAgentError } from "@/lib/observation-agent/observation-agent-error-display";

export function observationAgentErrorKey(entry: ObservationAgentErrorEntry): string {
  return `${entry.timestampUtc}|${entry.kind}|${entry.metric ?? ""}|${entry.message}`;
}

export function formatObservationAgentErrorMessage(entry: ObservationAgentErrorEntry): string {
  return humanizeObservationAgentError(entry);
}
