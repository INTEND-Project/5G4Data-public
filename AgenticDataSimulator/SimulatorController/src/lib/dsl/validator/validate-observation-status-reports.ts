import type { DslDiagnostic, DslStatement } from "@/lib/dsl/types";
import { extractObservationInstructionGlobals } from "@/lib/dsl/historic-observation-ticks";

/** Explicit `status_reports=` in instructions; omit → inherit settings (treated as off for DSL validation). */
export function parseObservationStatusReportsFlag(
  instructions: string,
): boolean | null {
  const globals = extractObservationInstructionGlobals(instructions);
  const raw = (globals.get("status_reports") ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "on" || raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "off" || raw === "false" || raw === "0" || raw === "no") return false;
  return null;
}

/**
 * When status_reports=on for an intent, at most one observation-report statement
 * may target that intent (all metrics must be in one multi-metric instructions string).
 * Explicit status_reports=off or missing flag → no restriction.
 */
export function validateObservationStatusReportSingleStatement(
  statements: DslStatement[],
): DslDiagnostic[] {
  const byIntent = new Map<
    string,
    Array<{ line: number; statusOn: boolean }>
  >();

  for (const statement of statements) {
    if (statement.kind !== "request-observation-report") continue;
    const flag = parseObservationStatusReportsFlag(statement.instructions);
    const statusOn = flag === true;
    const key = statement.intentAlias;
    const list = byIntent.get(key) ?? [];
    list.push({ line: statement.line, statusOn });
    byIntent.set(key, list);
  }

  const diagnostics: DslDiagnostic[] = [];
  for (const [intentAlias, rows] of byIntent) {
    const statusOnRows = rows.filter((r) => r.statusOn);
    if (statusOnRows.length === 0) continue;

    const allLines = rows.map((r) => r.line);
    if (rows.length <= 1) continue;

    const lineList = allLines.join(", ");
    const message =
      `Intent "${intentAlias}" has multiple request observation-report statements (lines ${lineList}) ` +
      `while status_reports=on. Use a single statement with repeated \`metric=…\` slices so compliance ` +
      `can evaluate all Conditions together.`;

    for (const line of allLines) {
      diagnostics.push({
        line,
        severity: "error",
        code: "STATUS_REPORTS_MULTI_STATEMENT",
        message,
      });
    }
  }

  return diagnostics;
}
