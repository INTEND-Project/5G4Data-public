import assert from "node:assert/strict";
import test from "node:test";
import { SampleBus } from "./sampleBus.js";

test("SampleBus retains samples in window and drops older points", () => {
  const bus = new SampleBus();
  bus.publish({ metric: "m1_COx", timestampMs: 1000, value: 1 });
  bus.publish({ metric: "m1_COx", timestampMs: 6000, value: 2 });
  bus.publish({ metric: "m1_COx", timestampMs: 9000, value: 3 });

  const windowed = bus.getSamplesInWindow("m1_COx", 10_000, 5000);
  assert.deepEqual(
    windowed.map((s) => s.value),
    [2, 3],
  );

  bus.clear();
  assert.equal(bus.getSamplesInWindow("m1_COx", 10_000, 4000).length, 0);
});
