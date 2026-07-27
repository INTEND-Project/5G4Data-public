import { parseCanonicalIntentLocalId } from "@/lib/intent/extract-intent-turtle";

/** Resolve DSL `for` intent ref: canonical `I…` id or alias from create-intent ingest. */
export function resolveIntentIdForObservation(
  intentRef: string,
  intentIdByAlias: Map<string, string>,
): string | null {
  return parseCanonicalIntentLocalId(intentRef) ?? intentIdByAlias.get(intentRef) ?? null;
}
