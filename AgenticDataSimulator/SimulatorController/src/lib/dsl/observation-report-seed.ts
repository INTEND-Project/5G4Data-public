/** Remove unsupported intent_id declarations from DSL instructions (bound via `for` clause). */
export function stripIntentIdFromInstructions(body: string): string {
  let s = body.trim();
  s = s.replace(/`intent_id\s*=\s*[^`]+`\s*,?\s*/gi, "");
  s = s.replace(/(?:^|\n)\s*intent_id\s*=\s*\S+\s*\n?/gi, "\n");
  return s.trim().replace(/^,\s*/, "");
}

/** True when instructions use structured synthetic backtick globals (mode, frequency, metric, …). */
export function looksStructuredObservationInstructions(body: string): boolean {
  return /`(?:mode|frequency|start|stop|metric)\s*=/i.test(body);
}

import type { ObservationStorageType } from "@/lib/dsl/types";
import { buildObservationStorageOverrideHint } from "@/lib/observation-storage";

export function buildObservationReportSeed(
  canonicalIntentId: string,
  instructions: string,
  storageOverride?: ObservationStorageType,
): string {
  const stripped = stripIntentIdFromInstructions(instructions);
  const intentGlobal = `\`intent_id=${canonicalIntentId}\``;
  const body = looksStructuredObservationInstructions(stripped)
    ? `${intentGlobal}, ${stripped}`
    : stripped;

  const lines = [`Generate observation reports for ${intentGlobal}.`];
  if (storageOverride) {
    lines.push("", buildObservationStorageOverrideHint(storageOverride));
  }
  lines.push("", "Instructions:", body);
  return lines.join("\n");
}
