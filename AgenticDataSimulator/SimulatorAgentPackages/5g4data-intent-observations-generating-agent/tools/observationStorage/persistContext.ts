import type { GraphDbTool } from "../graphdbTool.js";
import type { ObservationPayload } from "../observationTool.js";
import type { ObservationStorageId } from "../observationStorageTypes.js";

export interface ObservationPersistContext {
  storageId: ObservationStorageId;
  graphTool: GraphDbTool;
  payload: ObservationPayload;
  turtle: string;
  intentId: string;
  compoundMetric: string;
  conditionId: string;
  unit: string;
  /** When "buffer", prometheus samples are held for historic remote-write flush. */
  prometheusWriteMode?: "push" | "buffer";
}

export interface ObservationStorageBackend {
  readonly id: ObservationStorageId;
  persistObservation(ctx: ObservationPersistContext): Promise<boolean>;
  registerMetricMetadata(ctx: ObservationPersistContext): Promise<boolean>;
}
