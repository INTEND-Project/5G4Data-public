export type ObservationStorageType = "graphdb" | "prometheus";

export const DEFAULT_OBSERVATION_STORAGE: ObservationStorageType = "graphdb";

export function parseObservationStorageType(
  value: string | undefined
): ObservationStorageType | undefined {
  const t = value?.trim().toLowerCase();
  if (t === "graphdb" || t === "prometheus") return t;
  return undefined;
}

export function buildIntentGenerationStorageHint(storage: ObservationStorageType): string {
  return [
    `Observation report storage for this intent: ${storage}.`,
    `All ObservationReportingExpectation blocks must use icm:reportDestinations with rdfs:member data5g:${storage}.`
  ].join("\n");
}

export function buildObservationStorageOverrideHint(
  storage: ObservationStorageType
): string {
  return `Observation storage override: ${storage}. Use this storage for observation datapoints for this session (overrides intent reportDestinations unless intent Turtle specifies otherwise at runtime).`;
}

export function buildScriptReportingIntervalHint(seconds: number): string {
  return [
    `Observation reporting interval for this intent (from script): ${seconds} seconds.`,
    "Use time:unitSecond and matching numericDuration on duration nodes; per-anchor event class URIs as in the skill."
  ].join("\n");
}
