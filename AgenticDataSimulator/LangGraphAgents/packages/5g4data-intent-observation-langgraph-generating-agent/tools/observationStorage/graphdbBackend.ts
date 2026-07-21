import type { ObservationStorageBackend, ObservationPersistContext } from "./persistContext.js";

export const graphdbObservationBackend: ObservationStorageBackend = {
  id: "graphdb",

  async persistObservation(ctx: ObservationPersistContext): Promise<boolean> {
    if (process.env.NO_GRAPHDB === "true") return false;
    return ctx.graphTool.insertTurtle(ctx.turtle);
  },

  async registerMetricMetadata(ctx: ObservationPersistContext): Promise<boolean> {
    return ctx.graphTool.storeGraphdbMetadata(ctx.compoundMetric);
  }
};
