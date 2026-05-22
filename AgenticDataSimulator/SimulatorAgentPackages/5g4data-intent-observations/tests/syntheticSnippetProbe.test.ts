import assert from "node:assert/strict";
import test from "node:test";
import { localHourFromSim, parseUtcOffsetMinutes } from "../tools/syntheticPrng.js";
import { probeSnippetValues, validateSnippetSamples } from "../tools/syntheticSnippetProbe.js";

test("parseUtcOffsetMinutes accepts UTC+2 and +02:00", () => {
  assert.equal(parseUtcOffsetMinutes("UTC+2"), 120);
  assert.equal(parseUtcOffsetMinutes("+02:00"), 120);
  assert.equal(parseUtcOffsetMinutes("-05:30"), -(5 * 60 + 30));
});

test("localHourFromSim applies utc offset", () => {
  const sim = new Date("2026-05-17T04:00:00.000Z");
  assert.equal(localHourFromSim(sim, 120), 6);
});

test("probeSnippetValues rejects always-zero historic snippet", () => {
  const snippet = `
const hour = ctx.simTime.getUTCHours();
return (hour >= 6 && hour < 18) ? 500 + 500 * ctx.uniform01() : 0;
`.trim();

  const probe = probeSnippetValues({
    snippet,
    intentId: "I1",
    compoundMetric: "p99-token-target_COabc",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-05-17T05:00:00.000Z",
    historicEndIso: "2026-05-18T05:00:00.000Z"
  });

  assert.equal(probe.ok, true);
  if (!probe.ok) return;
  assert.ok(probe.values.some((v) => v > 0));
  assert.ok(probe.values.some((v) => v === 0));
});

test("validateSnippetSamples rejects snippet that is always zero", () => {
  const snippet = "return 0;";
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "metric_COabc",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-05-17T05:00:00.000Z",
    historicEndIso: "2026-05-18T05:00:00.000Z",
    instructionsSlice: "baseline 500-2000 during daytime"
  });
  assert.equal(result.ok, false);
});

test("validateSnippetSamples rejects constant output when range requested", () => {
  const snippet = "return 200;";
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "metric_COabc",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-05-17T05:00:00.000Z",
    historicEndIso: "2026-05-18T05:00:00.000Z",
    instructionsSlice: "use value span 500-2000"
  });
  assert.equal(result.ok, false);
});
