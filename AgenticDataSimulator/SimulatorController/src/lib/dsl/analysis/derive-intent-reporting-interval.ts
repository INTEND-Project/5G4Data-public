import {
  extractObservationInstructionGlobals,
  parseObservationFrequencyToSeconds,
} from "@/lib/dsl/historic-observation-ticks";
import type { DslDiagnostic, DslStatement } from "@/lib/dsl/types";

export function clampReportingIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return 600;
  return Math.min(86_400, Math.max(1, Math.round(value)));
}

export type DerivedIntentReportingInterval = {
  byIntentAlias: Map<string, number>;
  diagnostics: DslDiagnostic[];
};

export function deriveIntentReportingIntervalFromScript(
  statements: DslStatement[],
): DerivedIntentReportingInterval {
  const byIntentAlias = new Map<string, number>();
  const diagnostics: DslDiagnostic[] = [];
  const linesByAlias = new Map<string, Array<{ line: number; frequencySeconds: number }>>();

  for (const statement of statements) {
    if (statement.kind !== "request-observation-report") continue;
    const globals = extractObservationInstructionGlobals(statement.instructions);
    const frequencyRaw = globals.get("frequency");
    if (!frequencyRaw) continue;
    const frequencySeconds = parseObservationFrequencyToSeconds(frequencyRaw);
    if (frequencySeconds === undefined) continue;

    const alias = statement.intentAlias.trim();
    const entries = linesByAlias.get(alias) ?? [];
    entries.push({ line: statement.line, frequencySeconds });
    linesByAlias.set(alias, entries);
  }

  for (const [alias, entries] of linesByAlias) {
    const distinct = [...new Set(entries.map((e) => e.frequencySeconds))];
    const fastest = Math.min(...distinct.map((s) => clampReportingIntervalSeconds(s)));
    byIntentAlias.set(alias, fastest);

    if (distinct.length > 1) {
      const lineList = entries.map((e) => `line ${e.line} (${e.frequencySeconds}s)`).join(", ");
      diagnostics.push({
        line: entries[0]?.line ?? 1,
        severity: "warning",
        code: "REPORTING_INTERVAL_FREQUENCY_CONFLICT",
        message:
          `Intent alias "${alias}" has multiple observation-report frequencies (${lineList}); ` +
          `using fastest interval ${fastest} seconds for intent generation.`,
      });
    }
  }

  return { byIntentAlias, diagnostics };
}
