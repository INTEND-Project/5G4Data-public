/** True when instructions already declare intent_id (plain line or inside `backticks`). */
export function instructionsAlreadyDeclareIntentId(body: string): boolean {
  const trimmed = body.trim();
  if (/^\s*intent_id\s*=/im.test(trimmed)) {
    return true;
  }
  for (const m of trimmed.matchAll(/`([^`]+)`/g)) {
    if (/^\s*intent_id\s*=/i.test((m[1] ?? "").trim())) {
      return true;
    }
  }
  return false;
}

export function buildObservationReportSeed(
  dslIntentAlias: string,
  canonicalIntentId: string,
  instructions: string,
): string {
  const body = instructions.trim();
  const prelude = instructionsAlreadyDeclareIntentId(body)
    ? ([] as string[])
    : [`intent_id=${dslIntentAlias}`, ""];

  return [
    ...prelude,
    `Generate observation reports for \`intent_id=${canonicalIntentId}\`.`,
    "",
    "Instructions:",
    body,
  ].join("\n");
}
