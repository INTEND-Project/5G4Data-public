import type { ObservationAgentErrorEntry } from "@/app/api/observation-agent/errors/route";

const HOOK_FAILED_PREFIX = /^Observation hook failed:\s*/i;

const IMMEDIATE_FAILURE_PATTERNS: Array<{
  kind: ObservationAgentErrorEntry["kind"];
  test: RegExp;
}> = [
  { kind: "repl_hook_failed", test: HOOK_FAILED_PREFIX },
  {
    kind: "synthetic_setup_failed",
    test: /^Intent .+ could not be resolved from GraphDB/i,
  },
  {
    kind: "synthetic_setup_failed",
    test: /^Could not parse start\/stop timestamps/i,
  },
  {
    kind: "synthetic_setup_failed",
    test: /^Metric .+ is not defined in GraphDB intent/i,
  },
];

function normalizeAgentFailureMessage(text: string): string {
  return text.replace(HOOK_FAILED_PREFIX, "").trim();
}

/** Map an observation-agent A2A reply to a pollable error entry when setup failed before workers start. */
export function parseObservationAgentFailure(
  agentText: string,
  intentId: string,
): ObservationAgentErrorEntry | null {
  const trimmed = agentText.trim();
  if (!trimmed.length || !intentId.trim()) {
    return null;
  }

  const firstLine = trimmed.split("\n").map((line) => line.trim()).find(Boolean) ?? trimmed;
  const match = IMMEDIATE_FAILURE_PATTERNS.find(({ test }) => test.test(firstLine));
  if (!match) {
    return null;
  }

  return {
    schemaVersion: "observation_error_v1",
    timestampUtc: new Date().toISOString(),
    kind: match.kind,
    message: normalizeAgentFailureMessage(firstLine),
    intentId: intentId.trim(),
  };
}
