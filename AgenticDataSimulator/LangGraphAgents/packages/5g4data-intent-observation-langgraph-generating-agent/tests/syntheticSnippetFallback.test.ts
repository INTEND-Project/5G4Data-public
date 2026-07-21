import assert from "node:assert/strict";
import test from "node:test";

import { buildValidatedFallbackSnippet } from "../tools/syntheticSnippetFallback.js";

const INCIDENT_INSTRUCTIONS =
  "For `metric=p99-token-target`, default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily variation and low noise. During stress periodes between 08:00-09:00 and 16:00-17:00 every day create dips down to between 200-300 for periods lasting between 3-10 minutes and generate at least two days with dips per stress periode every week";

const ENERGY_INSTRUCTIONS =
  "Monotonically increasing cumulative counter in joules (running total, not a per-tick gauge). Start at 10 J on tick 0. For each step i from 1 through ctx.tickIndex, add a strictly positive increment. Base off-peak increment is 8 J per 5m step. Apply a diurnal multiplier from simulated UTC time at step i: 22:00–06:00 use 0.4–0.6× base; 06:00–18:00 use 1.3–2.0× base with day-to-day variation via ctx.uniformForStep(i); 18:00–22:00 use 0.8–1.2× base. During stress windows 08:00–09:00 and 16:00–17:00, create at least two spike episodes per window per day lasting 3–10 minutes (1–2 ticks at 5m) where the increment multiplier is 2.5–4.0× the normal daytime increment; schedule episode starts deterministically with ctx.uniformForStep(dayIndex * 1000 + windowId * 100 + spikeIndex). Multiply each step by jitter f = 0.7 + 0.6 * ctx.uniformForStep(i). Each emitted value is the running total after summing steps 0..ctx.tickIndex. Use an explicit loop for (let i = 1; i <= ctx.tickIndex; i++). Values must never decrease.";

const HISTORIC_BOUNDS = {
  startIso: "2026-04-15T05:00:00.000Z",
  endIso: "2026-05-22T05:00:00.000Z",
};

test("buildValidatedFallbackSnippet produces monotonic cumulative energy snippet", () => {
  const result = buildValidatedFallbackSnippet({
    fullUserPrompt: ENERGY_INSTRUCTIONS,
    intentId: "Iabc1234567890123456789012345678",
    compoundMetric: "energy-consumption_COabc1234567890123456789012345678",
    kgUnitResolved: "J",
    instructionsSlice: ENERGY_INSTRUCTIONS,
    mode: "historic",
    frequencySeconds: 300,
    historicBounds: HISTORIC_BOUNDS,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.snippet, /for\s*\(\s*let i = 1; i <= ctx\.tickIndex/i);
});

test("buildValidatedFallbackSnippet produces stress-dip gauge snippet", () => {
  const result = buildValidatedFallbackSnippet({
    fullUserPrompt: INCIDENT_INSTRUCTIONS,
    intentId: "Iabc1234567890123456789012345678",
    compoundMetric: "p99-token-target_COabc1234567890123456789012345678",
    kgUnitResolved: "NA",
    instructionsSlice: INCIDENT_INSTRUCTIONS,
    mode: "historic",
    frequencySeconds: 300,
    historicBounds: HISTORIC_BOUNDS,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.snippet, /ctx\.tickInHour/);
});
