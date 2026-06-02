import { describe, expect, it } from "vitest";

import type { ObservationProgressSnapshot } from "@/lib/observation-agent/progress-types";

function summarizeProgress(progress: ObservationProgressSnapshot): string {
  const { aggregate, phase, codegenMetricsDone, codegenMetricsTotal } = progress;
  if (phase === "codegen") {
    return `codegen:${codegenMetricsDone}/${codegenMetricsTotal}`;
  }
  if (aggregate.ticksTotal !== null) {
    return `ticks:${aggregate.ticksDone}/${aggregate.ticksTotal}`;
  }
  return `phase:${phase}`;
}

describe("observation progress snapshot summaries", () => {
  it("reports codegen phase counts", () => {
    const snapshot: ObservationProgressSnapshot = {
      schemaVersion: "observation_progress_v1",
      updatedAt: new Date().toISOString(),
      intentId: "Iabc1234567890123456789012345678",
      mode: "historic",
      phase: "codegen",
      codegenMetricsDone: 1,
      codegenMetricsTotal: 3,
      metrics: [],
      aggregate: { ticksDone: 0, ticksTotal: 300, percent: 0 },
    };
    expect(summarizeProgress(snapshot)).toBe("codegen:1/3");
  });

  it("reports tick aggregate during generating", () => {
    const snapshot: ObservationProgressSnapshot = {
      schemaVersion: "observation_progress_v1",
      updatedAt: new Date().toISOString(),
      intentId: "Iabc1234567890123456789012345678",
      mode: "historic",
      phase: "generating",
      codegenMetricsDone: 3,
      codegenMetricsTotal: 3,
      metrics: [],
      aggregate: { ticksDone: 150, ticksTotal: 300, percent: 50 },
    };
    expect(summarizeProgress(snapshot)).toBe("ticks:150/300");
  });
});
