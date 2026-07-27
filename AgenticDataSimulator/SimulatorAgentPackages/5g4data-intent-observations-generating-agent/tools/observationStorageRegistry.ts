import type { GraphDbTool } from "./graphdbTool.js";
import { graphdbObservationBackend } from "./observationStorage/graphdbBackend.js";
import { createPrometheusObservationBackend, flushBufferedPrometheusRemoteWrite } from "./observationStorage/prometheusBackend.js";
import type {
  ObservationPersistContext,
  ObservationStorageBackend
} from "./observationStorage/persistContext.js";
import {
  type ObservationStorageId,
  isObservationStorageId
} from "./observationStorageTypes.js";

const staticBackends = new Map<ObservationStorageId, ObservationStorageBackend>([
  ["graphdb", graphdbObservationBackend]
]);

let prometheusBackend: ObservationStorageBackend | null = null;

function getPrometheusBackend(): ObservationStorageBackend {
  if (!prometheusBackend) {
    prometheusBackend = createPrometheusObservationBackend();
  }
  return prometheusBackend;
}

export function getObservationStorageBackend(id: ObservationStorageId): ObservationStorageBackend {
  if (id === "prometheus") return getPrometheusBackend();
  return staticBackends.get(id) ?? graphdbObservationBackend;
}

export async function persistObservationToStorages(
  storageIds: ObservationStorageId[],
  ctx: Omit<ObservationPersistContext, "storageId">
): Promise<{ graphDbWritten: boolean; prometheusWritten: boolean }> {
  let graphDbWritten = false;
  let prometheusWritten = false;

  for (const storageId of storageIds) {
    const backend = getObservationStorageBackend(storageId);
    const fullCtx: ObservationPersistContext = { ...ctx, storageId };
    const ok = await backend.persistObservation(fullCtx);
    if (storageId === "graphdb" && ok) graphDbWritten = true;
    if (storageId === "prometheus" && ok) prometheusWritten = true;
  }

  return { graphDbWritten, prometheusWritten };
}

export async function registerMetricMetadataForStorages(
  storageIds: ObservationStorageId[],
  ctx: Omit<ObservationPersistContext, "storageId">,
  registered: Set<string>
): Promise<void> {
  const metric = ctx.compoundMetric;
  if (registered.has(metric)) return;

  for (const storageId of storageIds) {
    const backend = getObservationStorageBackend(storageId);
    const fullCtx: ObservationPersistContext = { ...ctx, storageId };
    const ok = await backend.registerMetricMetadata(fullCtx);
    if (!ok) {
      process.stderr.write(
        `Warning: failed to store ${storageId} metadata for metric ${metric}\n`
      );
    }
  }
  registered.add(metric);
}

export function resetPrometheusBackendForTests(): void {
  prometheusBackend = null;
}

export { flushBufferedPrometheusRemoteWrite };

export function registerObservationStorageBackend(
  id: string,
  backend: ObservationStorageBackend
): void {
  if (!isObservationStorageId(id)) {
    throw new Error(`Unknown observation storage id: ${id}`);
  }
  if (id === "prometheus") {
    prometheusBackend = backend;
  } else {
    staticBackends.set(id, backend);
  }
}

export type { GraphDbTool };
