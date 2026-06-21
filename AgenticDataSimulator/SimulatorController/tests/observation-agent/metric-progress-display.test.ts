import { describe, expect, it } from "vitest";

import {
  detectStuckPendingMetrics,
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

  it("shows error message for failed metrics", () => {
    expect(
      metricProgressDetailLabel(
        entry({
          compoundMetric: "m1",
          phase: "failed",
          errorMessage: "Metric p99-token-target is not defined in GraphDB intent",
        }),
      ),
    ).toContain("Metric p99-token-target");
  });

  it("merges setup errors into expected metric rows as failed", () => {
    const merged = mergeObservationProgressWithExpectedMetrics(
      null,
      ["p99-token-target"],
      "Iabc1234567890123456789012345678",
      [
        {
          kind: "synthetic_setup_failed",
          message: "Metric p99-token-target is not defined in GraphDB intent",
          metric: "p99-token-target",
        },
      ],
    );
    expect(merged?.metrics[0]?.phase).toBe("failed");
    expect(merged?.phase).toBe("failed");
  });

  it("detects stuck pending metrics from setup errors", () => {
    const hint = detectStuckPendingMetrics(
      {
        schemaVersion: "observation_progress_v1",
        updatedAt: new Date(0).toISOString(),
        intentId: "Iabc1234567890123456789012345678",
        mode: "historic",
        phase: "generating",
        codegenMetricsDone: 0,
        codegenMetricsTotal: 0,
        metrics: [],
        aggregate: { ticksDone: 0, ticksTotal: null, percent: null },
      },
      ["p99-token-target"],
      [
        {
          kind: "synthetic_setup_failed",
          message: "Metric p99-token-target is not defined in GraphDB intent",
          metric: "p99-token-target",
        },
      ],
    );
    expect(hint).toContain("not defined");
  });

  it("detects repl hook failures without waiting for the stuck timeout", () => {
    const hint = detectStuckPendingMetrics(
      mergeObservationProgressWithExpectedMetrics(
        null,
        ["p99-token-target"],
        "Iabc1234567890123456789012345678",
        [
          {
            kind: "repl_hook_failed",
            message: "Cannot find module prettyPrintIntentTurtle.js",
            intentId: "Iabc1234567890123456789012345678",
          },
        ],
      ),
      ["p99-token-target"],
      [
        {
          kind: "repl_hook_failed",
          message: "Cannot find module prettyPrintIntentTurtle.js",
          intentId: "Iabc1234567890123456789012345678",
        },
      ],
      { awaitingSinceMs: Date.now() },
    );
    expect(hint).toContain("prettyPrintIntentTurtle");
  });

  it("shows stuck hint after awaiting threshold when metrics never leave pending", () => {
    const awaitingSinceMs = Date.now() - 61_000;
    const hint = detectStuckPendingMetrics(
      mergeObservationProgressWithExpectedMetrics(
        null,
        ["p99-token-target"],
        "Iabc1234567890123456789012345678",
      ),
      ["p99-token-target"],
      [],
      { awaitingSinceMs, rawAgentProgress: null },
    );
    expect(hint).toContain("has not started metric workers");
  });

  it("does not show stuck hint before awaiting threshold", () => {
    const hint = detectStuckPendingMetrics(
      mergeObservationProgressWithExpectedMetrics(
        null,
        ["p99-token-target"],
        "Iabc1234567890123456789012345678",
      ),
      ["p99-token-target"],
      [],
      { awaitingSinceMs: Date.now(), rawAgentProgress: null },
    );
    expect(hint).toBeNull();
  });

  it("merges prometheus remote write failures into pending metric rows", () => {
    const intentId = "Iabc1234567890123456789012345678";
    const compoundMetric = `detection-latency_CO${intentId.slice(1)}`;
    const setupErrors = [
      {
        kind: "prometheus_remote_write_flush_failed",
        message:
          "Prometheus was unreachable at flush time for detection-latency after generating 2,881 samples (http://host.docker.internal:9090/api/v1/write). Start or restart Prometheus (cd Prometheus && ./start.sh), confirm the Controller Prometheus URL is http://127.0.0.1:9090, then re-run the observation-report step.",
        metric: "detection-latency",
        intentId,
      },
    ];
    const merged = mergeObservationProgressWithExpectedMetrics(
      {
        schemaVersion: "observation_progress_v1",
        updatedAt: new Date().toISOString(),
        intentId,
        mode: "historic",
        phase: "generating",
        codegenMetricsDone: 1,
        codegenMetricsTotal: 1,
        metrics: [
          {
            compoundMetric,
            phase: "failed",
            ticksDone: 2881,
            ticksTotal: 2881,
          },
        ],
        aggregate: { ticksDone: 2881, ticksTotal: 2881, percent: 100 },
      },
      [compoundMetric, "bandwidth_COabc1234567890123456789012345678"],
      intentId,
      setupErrors,
    );

    const pendingRow = merged?.metrics.find(
      (entry) => entry.compoundMetric === "bandwidth_COabc1234567890123456789012345678",
    );
    expect(pendingRow?.phase).toBe("failed");
    expect(pendingRow?.errorMessage).toContain("Prometheus");
    expect(merged?.phase).toBe("failed");
  });

  it("surfaces prometheus flush errors immediately without stuck timeout", () => {
    const intentId = "Iabc1234567890123456789012345678";
    const hint = detectStuckPendingMetrics(
      null,
      ["detection-latency"],
      [
        {
          kind: "prometheus_remote_write_flush_failed",
          message:
            "Prometheus was unreachable at flush time. Start or restart Prometheus (cd Prometheus && ./start.sh).",
          intentId,
        },
      ],
      { awaitingSinceMs: Date.now() },
    );
    expect(hint).toContain("Prometheus");
  });
});
