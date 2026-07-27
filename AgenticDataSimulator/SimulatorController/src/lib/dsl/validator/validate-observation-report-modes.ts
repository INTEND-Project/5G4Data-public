import type { DslDiagnostic, DslStatement } from "@/lib/dsl/types";
import { parseObservationSyntheticMode } from "@/lib/dsl/historic-observation-ticks";

export function validateObservationReportModeMix(
  statements: DslStatement[],
): DslDiagnostic[] {
  const historicLines: number[] = [];
  const streamingLines: number[] = [];

  for (const statement of statements) {
    if (statement.kind !== "request-observation-report") {
      continue;
    }
    const mode = parseObservationSyntheticMode(statement.instructions);
    if (mode === "historic") {
      historicLines.push(statement.line);
    } else if (mode === "streaming") {
      streamingLines.push(statement.line);
    }
  }

  if (historicLines.length === 0 || streamingLines.length === 0) {
    return [];
  }

  const lineList = (lines: number[]): string => lines.join(", ");
  const message =
    `Script mixes historic and streaming modes in request observation-report commands ` +
    `(historic on line ${lineList(historicLines)}; streaming on line ${lineList(streamingLines)}). ` +
    `Use a single mode for every observation-report statement.`;

  const affectedLines = [...historicLines, ...streamingLines];
  return affectedLines.map((line) => ({
    line,
    severity: "error" as const,
    code: "MIXED_OBSERVATION_SYNTH_MODES",
    message,
  }));
}
