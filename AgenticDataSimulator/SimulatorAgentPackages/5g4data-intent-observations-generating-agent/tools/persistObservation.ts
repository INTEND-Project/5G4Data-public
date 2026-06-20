import type { GraphDbTool } from "./graphdbTool.js";
import { logObservationPayload } from "./observationLog.js";
import type { ObservationPayload } from "./observationTool.js";
import {
  persistObservationToStorages,
  registerMetricMetadataForStorages
} from "./observationStorageRegistry.js";
import type { ObservationStorageId } from "./observationStorageTypes.js";
import { resolveObservationStorageTypes } from "./resolveObservationStorage.js";

export interface PersistObservationArgs {
  graphTool: GraphDbTool;
  intentId: string;
  compoundMetric: string;
  conditionId: string;
  unit: string;
  payload: ObservationPayload;
  turtle: string;
  storageTypes: ObservationStorageId[];
  sessionOverride?: ObservationStorageId | null;
  createIntentStorage?: ObservationStorageId | null;
  log: {
    source: "stream" | "synthetic";
    sessionId?: string;
    frequencySeconds?: number;
  };
  prometheusWriteMode?: "push" | "buffer";
}

export async function persistObservationWithStorage(
  args: PersistObservationArgs
): Promise<{ graphDbWritten: boolean; storageIds: ObservationStorageId[] }> {
  const storageIds = resolveObservationStorageTypes({
    sessionOverride: args.sessionOverride,
    intentDestinations: args.storageTypes,
    createIntentStorage: args.createIntentStorage
  });

  const noGraphDb = process.env.NO_GRAPHDB === "true";
  const onlyGraphdb = storageIds.length === 1 && storageIds[0] === "graphdb";

  if (noGraphDb && onlyGraphdb) {
    process.stdout.write(`${args.turtle}\n\nGraphDB write skipped (--noGraphDB)\n`);
    logObservationPayload({
      source: args.log.source,
      sessionId: args.log.sessionId,
      intentId: args.intentId,
      payload: args.payload,
      turtle: args.turtle,
      graphDbWritten: false,
      frequencySeconds: args.log.frequencySeconds
    });
    return { graphDbWritten: false, storageIds };
  }

  const { graphDbWritten } = await persistObservationToStorages(storageIds, {
    graphTool: args.graphTool,
    payload: args.payload,
    turtle: args.turtle,
    intentId: args.intentId,
    compoundMetric: args.compoundMetric,
    conditionId: args.conditionId,
    unit: args.unit,
    prometheusWriteMode: args.prometheusWriteMode
  });

  if (!graphDbWritten && onlyGraphdb && noGraphDb) {
    process.stdout.write(`${args.turtle}\n\nGraphDB write skipped (--noGraphDB)\n`);
  }

  logObservationPayload({
    source: args.log.source,
    sessionId: args.log.sessionId,
    intentId: args.intentId,
    payload: args.payload,
    turtle: args.turtle,
    graphDbWritten,
    frequencySeconds: args.log.frequencySeconds
  });

  return { graphDbWritten, storageIds };
}

export async function registerObservationMetadataForMetric(
  graphTool: GraphDbTool,
  metric: string,
  conditionId: string,
  unit: string,
  intentId: string,
  storageTypes: ObservationStorageId[],
  sessionOverride: ObservationStorageId | null | undefined,
  createIntentStorage: ObservationStorageId | null | undefined,
  registered: Set<string>
): Promise<void> {
  const resolved = resolveObservationStorageTypes({
    sessionOverride,
    intentDestinations: storageTypes,
    createIntentStorage
  });

  await registerMetricMetadataForStorages(
    resolved,
    {
      graphTool,
      payload: {
        observationId: "",
        observedMetric: metric,
        value: 0,
        unit,
        obtainedAt: ""
      },
      turtle: "",
      intentId,
      compoundMetric: metric,
      conditionId,
      unit
    },
    registered
  );
}
