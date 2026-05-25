import {
  DEFAULT_OBSERVATION_STORAGE,
  type ObservationStorageId,
  parseObservationStorageId
} from "./observationStorageTypes.js";

export interface ResolveObservationStorageInput {
  /** From `request observation-report … storage` or A2A session override. */
  sessionOverride?: ObservationStorageId | string | null;
  /** From intent Turtle `icm:reportDestinations` for this stream/metric. */
  intentDestinations?: ObservationStorageId[];
  /** From Controller `create intent … storage` alias map. */
  createIntentStorage?: ObservationStorageId | string | null;
}

/**
 * Resolution order: session override → intent Turtle destinations → create-intent alias → default graphdb.
 */
export function resolveObservationStorageTypes(
  input: ResolveObservationStorageInput
): ObservationStorageId[] {
  const override = parseObservationStorageId(input.sessionOverride ?? undefined);
  if (override) return [override];

  const fromIntent = input.intentDestinations?.filter((id) => id === "graphdb" || id === "prometheus");
  if (fromIntent && fromIntent.length > 0) return [...new Set(fromIntent)];

  const fromCreate = parseObservationStorageId(input.createIntentStorage ?? undefined);
  if (fromCreate) return [fromCreate];

  return [DEFAULT_OBSERVATION_STORAGE];
}

export function resolvePrimaryObservationStorage(
  input: ResolveObservationStorageInput
): ObservationStorageId {
  return resolveObservationStorageTypes(input)[0] ?? DEFAULT_OBSERVATION_STORAGE;
}
