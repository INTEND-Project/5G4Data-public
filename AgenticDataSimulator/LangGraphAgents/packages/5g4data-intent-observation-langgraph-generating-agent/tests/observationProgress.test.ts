import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeAggregate,
  historicTickCount,
  initObservationProgress,
  readObservationProgress,
  reportWorkerTickProgress,
  updateMetricProgress,
} from "../tools/observationProgress.js";

test("historicTickCount matches window math", () => {
  const start = new Date("2024-01-01T00:00:00Z");
  const end = new Date("2024-01-01T01:00:00Z");
  assert.equal(historicTickCount(start, end, 60), 61);
});

test("computeAggregate sums bounded metrics", () => {
  const aggregate = computeAggregate([
    { compoundMetric: "a", phase: "generating", ticksDone: 50, ticksTotal: 100 },
    { compoundMetric: "b", phase: "generating", ticksDone: 25, ticksTotal: 100 },
  ]);
  assert.equal(aggregate.ticksDone, 75);
  assert.equal(aggregate.ticksTotal, 200);
  assert.equal(aggregate.percent, 37.5);
});

test("init merges new metrics into existing progress for the same intent", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-progress-merge-"));
  const prev = process.env.OBSERVATION_LOG_PATH;
  process.env.OBSERVATION_LOG_PATH = dir;
  try {
    const intentId = "Iabc1234567890123456789012345678";
    const metricA = "metricA_COabc1234567890123456789012345678";
    const metricB = "metricB_COabc1234567890123456789012345678";

    initObservationProgress({
      intentId,
      sessionId: "sess1",
      mode: "historic",
      compoundMetrics: [metricA],
      ticksTotalPerMetric: new Map([[metricA, 10]]),
    });

    updateMetricProgress(intentId, metricA, {
      phase: "completed",
      ticksDone: 10,
      ticksTotal: 10,
    });

    initObservationProgress({
      intentId,
      sessionId: "sess2",
      mode: "historic",
      compoundMetrics: [metricB],
      ticksTotalPerMetric: new Map([[metricB, 20]]),
    });

    const snapshot = readObservationProgress(intentId);
    assert.ok(snapshot);
    assert.equal(snapshot?.metrics.length, 2);
    assert.equal(snapshot?.metrics[0]?.compoundMetric, metricA);
    assert.equal(snapshot?.metrics[0]?.phase, "completed");
    assert.equal(snapshot?.metrics[1]?.compoundMetric, metricB);
    assert.equal(snapshot?.metrics[1]?.phase, "pending");
  } finally {
    if (prev === undefined) delete process.env.OBSERVATION_LOG_PATH;
    else process.env.OBSERVATION_LOG_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("init and worker updates write atomic progress file", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-progress-"));
  const prev = process.env.OBSERVATION_LOG_PATH;
  process.env.OBSERVATION_LOG_PATH = dir;
  try {
    initObservationProgress({
      intentId: "Iabc1234567890123456789012345678",
      sessionId: "sess1",
      mode: "historic",
      compoundMetrics: ["metricA_COabc1234567890123456789012345678"],
      ticksTotalPerMetric: new Map([
        ["metricA_COabc1234567890123456789012345678", 10],
      ]),
    });

    const path = join(dir, "observation-progress", "Iabc1234567890123456789012345678.json");
    assert.ok(existsSync(path));

    reportWorkerTickProgress({
      intentId: "Iabc1234567890123456789012345678",
      compoundMetric: "metricA_COabc1234567890123456789012345678",
      ticksDone: 5,
      ticksTotal: 10,
      force: true,
    });

    const snapshot = readObservationProgress("Iabc1234567890123456789012345678");
    assert.ok(snapshot);
    assert.equal(snapshot?.aggregate.ticksDone, 5);
    assert.equal(snapshot?.aggregate.percent, 50);

    updateMetricProgress(
      "Iabc1234567890123456789012345678",
      "metricA_COabc1234567890123456789012345678",
      { phase: "completed", ticksDone: 10 },
    );
    const done = readObservationProgress("Iabc1234567890123456789012345678");
    assert.equal(done?.phase, "completed");
    assert.equal(done?.aggregate.percent, 100);

    const raw = readFileSync(path, "utf8");
    assert.ok(raw.includes("observation_progress_v1"));
  } finally {
    if (prev === undefined) delete process.env.OBSERVATION_LOG_PATH;
    else process.env.OBSERVATION_LOG_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
