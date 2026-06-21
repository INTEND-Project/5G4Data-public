import { describe, expect, it } from "vitest";

import {
  applyScriptRequestedMetricsScope,
  observationProgressCoversScriptMetrics,
  resolveScriptScopedReadiness,
} from "@/lib/intents/script-scoped-readiness";

describe("applyScriptRequestedMetricsScope", () => {
  it("scopes totals to script-requested metrics when intent has more conditions", () => {
    expect(
      applyScriptRequestedMetricsScope(
        { metricsReady: 2, metricsTotal: 3, dataStatus: "pending" },
        ["detection-latency_COabc", "latency_COdef"],
        ["detection-latency_COabc", "latency_COdef", "bandwidth_COghi"],
      ),
    ).toEqual({
      metricsReady: 2,
      metricsTotal: 2,
      dataStatus: "ready",
    });
  });

  it("does not mark ready when only unrelated intent metrics are stored", () => {
    expect(
      applyScriptRequestedMetricsScope(
        { metricsReady: 2, metricsTotal: 3, dataStatus: "pending" },
        ["detection-latency_COabc", "latency_COdef"],
        ["bandwidth_COghi", "detection-latency_COabc"],
      ),
    ).toEqual({
      metricsReady: 1,
      metricsTotal: 2,
      dataStatus: "pending",
    });
  });

  it("matches script stems to compound metric names", () => {
    expect(
      applyScriptRequestedMetricsScope(
        { metricsReady: 2, metricsTotal: 3, dataStatus: "pending" },
        ["detection-latency", "latency"],
        ["detection-latency_COabc", "latency_COdef"],
      ),
    ).toEqual({
      metricsReady: 2,
      metricsTotal: 2,
      dataStatus: "ready",
    });
  });

  it("leaves API readiness unchanged when no script scope exists", () => {
    const api = { metricsReady: 2, metricsTotal: 3, dataStatus: "pending" as const };
    expect(applyScriptRequestedMetricsScope(api, undefined)).toEqual(api);
    expect(applyScriptRequestedMetricsScope(api, [])).toEqual(api);
  });
});

describe("resolveScriptScopedReadiness", () => {
  it("treats script metrics as ready when historic progress completed them", () => {
    const result = resolveScriptScopedReadiness(
      { metricsReady: 2, metricsTotal: 3, dataStatus: "pending" },
      ["detection-latency_COabc", "latency_COdef"],
      ["detection-latency_COabc"],
      {
        mode: "historic",
        metrics: [
          { compoundMetric: "detection-latency_COabc", phase: "completed" },
          { compoundMetric: "latency_COdef", phase: "completed" },
        ],
      },
    );

    expect(result).toEqual({
      metricsReady: 2,
      metricsTotal: 2,
      dataStatus: "ready",
    });
  });
});

describe("observationProgressCoversScriptMetrics", () => {
  it("returns true only when every script metric completed", () => {
    expect(
      observationProgressCoversScriptMetrics(
        {
          mode: "historic",
          metrics: [
            { compoundMetric: "detection-latency_COabc", phase: "completed" },
            { compoundMetric: "latency_COdef", phase: "generating" },
          ],
        },
        ["detection-latency_COabc", "latency_COdef"],
      ),
    ).toBe(false);
  });
});
