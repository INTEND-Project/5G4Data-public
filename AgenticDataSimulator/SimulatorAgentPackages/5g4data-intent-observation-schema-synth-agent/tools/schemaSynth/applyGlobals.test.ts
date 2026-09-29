import assert from "node:assert/strict";
import test from "node:test";
import { applyPromptGlobalsToConstraint } from "../syntheticRunOrchestrator.js";
import { parseConstraintDocument } from "./index.js";

test("applyPromptGlobalsToConstraint forces historic window and metric", () => {
  const doc = parseConstraintDocument({
    version: 1,
    samplingKind: "gauge",
    timeline: {
      mode: "streaming",
      frequencySeconds: 120
    },
    metrics: [{ name: "placeholder" }],
    defaultBand: { min: 1, max: 10 }
  });
  const next = applyPromptGlobalsToConstraint(doc, {
    mode: "historic",
    frequencySeconds: 60,
    metricName: "p99-token-target_COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    historicStart: new Date("2026-05-21T05:00:00Z"),
    historicEnd: new Date("2026-05-22T05:00:00Z"),
    unit: "ms",
    seed: "test-seed"
  });
  assert.equal(next.timeline.mode, "historic");
  assert.equal(next.timeline.frequencySeconds, 60);
  assert.equal(next.timeline.start, "2026-05-21T05:00:00Z");
  assert.equal(next.timeline.stop, "2026-05-22T05:00:00Z");
  assert.equal(next.metrics[0].name, "p99-token-target_COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(next.metrics[0].unit, "ms");
  assert.equal(next.seed, "test-seed");
});
