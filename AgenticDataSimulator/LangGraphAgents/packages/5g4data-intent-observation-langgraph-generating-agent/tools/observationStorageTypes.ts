/** Supported observation datapoint storage backends (extensible registry). */
export type ObservationStorageId = "graphdb" | "prometheus";

const KNOWN: ReadonlySet<string> = new Set(["graphdb", "prometheus"]);

export function isObservationStorageId(value: string): value is ObservationStorageId {
  return KNOWN.has(value);
}

export function parseObservationStorageId(
  value: string | undefined | null
): ObservationStorageId | undefined {
  const t = value?.trim().toLowerCase();
  if (!t || !isObservationStorageId(t)) return undefined;
  return t;
}

export const DEFAULT_OBSERVATION_STORAGE: ObservationStorageId = "graphdb";
