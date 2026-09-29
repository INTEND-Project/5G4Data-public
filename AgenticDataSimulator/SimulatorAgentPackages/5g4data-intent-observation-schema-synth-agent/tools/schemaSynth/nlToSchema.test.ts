import assert from "node:assert/strict";
import test from "node:test";
import { ConstraintDocumentSchema } from "./schema/types.js";
import { heuristicNlToSchema } from "./nlToSchema.js";

test("Zod rejects invalid band", () => {
  const r = ConstraintDocumentSchema.safeParse({
    version: 1,
    samplingKind: "gauge",
    timeline: {
      mode: "historic",
      start: "2026-05-21T05:00:00Z",
      stop: "2026-05-22T05:00:00Z",
      frequencySeconds: 60
    },
    metrics: [{ name: "x" }],
    defaultBand: { min: 10, max: 5 }
  });
  assert.equal(r.success, false);
});

test("heuristicNlToSchema maps p99 stress globals", () => {
  const instructions =
    "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily variation and low noise. During stress periods between 08:00-09:00 and 16:00-17:00 create dips down to between 200-300 for periods lasting between 3-10 minutes, at least two dips per stress period";
  const doc = heuristicNlToSchema(instructions);
  assert.equal(doc.metrics[0].name, "p99-token-target");
  assert.equal(doc.timeline.frequencySeconds, 60);
  assert.equal(doc.defaultBand?.min, 700);
  assert.ok((doc.episodes?.length ?? 0) >= 1);
});

test("streaming timeline without start/stop parses", () => {
  const r = ConstraintDocumentSchema.safeParse({
    version: 1,
    samplingKind: "gauge",
    timeline: { mode: "streaming", frequencySeconds: 30 },
    metrics: [{ name: "cpu-utilization" }],
    defaultBand: { min: 10, max: 40 }
  });
  assert.equal(r.success, true, JSON.stringify(r));
});
