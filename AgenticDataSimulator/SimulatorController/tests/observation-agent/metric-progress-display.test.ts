import { describe, expect, it } from "vitest";

import {
  mergeObservationProgressWithExpectedMetrics,
  metricProgressDetailLabel,
  metricProgressPercent,
} from "../../src/lib/observation-agent/metric-progress-display";
import type { MetricProgressEntry } from "../../src/lib/observation-agent/progress-types";

function entry(
  partial: Partial<MetricProgressEntry> & Pick<MetricProgressEntry, "compoundMetric">,
): MetricProgressEntry {
  return {
    phase: "pending",
    ticksDone: 0,
    ticksTotal: null,
    ...partial,
  };
}

describe("metric progress display", () => {
  it("computes percent from ticks per metric", () => {
    expect(
      metricProgressPercent(
        entry({
          compoundMetric: "m1",
          phase: "generating",
          ticksDone: 50,
          ticksTotal: 200,
        }),
      ),
    ).toBe(25);
  });

  it("fills pending rows for expected metrics before agent reports them", () => {
    const merged = mergeObservationProgressWithExpectedMetrics(
      {
        schemaVersion: "observation_progress_v1",
        updatedAt: new Date().toISOString(),
        intentId: "Iabc1234567890123456789012345678",
        mode: "historic",
        phase: "generating",
        codegenMetricsDone: 1,
        codegenMetricsTotal: 2,
        metrics: [
          {
            compoundMetric: "metricA_COabc1234567890123456789012345678",
            phase: "generating",
            ticksDone: 10,
            ticksTotal: 100,
          },
        ],
        aggregate: { ticksDone: 10, ticksTotal: 100, percent: 10 },
      },
      [
        "metricA_COabc1234567890123456789012345678",
        "metricB_COabc1234567890123456789012345678",
      ],
      "Iabc1234567890123456789012345678",
    );

    expect(merged?.metrics).toHaveLength(2);
    expect(merged?.metrics[1]?.compoundMetric).toBe(
      "metricB_COabc1234567890123456789012345678",
    );
    expect(merged?.metrics[1]?.phase).toBe("pending");
  });

  it("labels generating metrics with tick counts", () => {
    expect(
      metricProgressDetailLabel(
        entry({
          compoundMetric: "m1",
          phase: "generating",
          ticksDone: 10,
          ticksTotal: 100,
        }),
      ),
    ).toContain("10 / 100 ticks");
  });
});
