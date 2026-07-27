import assert from "node:assert/strict";
import test from "node:test";
import { localHourFromSim, parseUtcOffsetMinutes } from "../tools/syntheticPrng.js";
import {
  cumulativeProbeTickCount,
  CUMULATIVE_VALIDATION_PROBE_CAP,
  inferSamplingKind,
  looksLikeCumulativeCounter,
  looksLikeGaugeMetric,
  looksLikeStressDipPattern,
  probeSequentialSnippetValues,
  probeSnippetValues,
  resolveCodegenModuleNames,
  snippetLooksLikeAccumulationLoop,
  validateSnippetSamples
} from "../tools/syntheticSnippetProbe.js";

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

test("looksLikeCumulativeCounter uses instructions only, not metric names", () => {
  assert.equal(looksLikeCumulativeCounter(undefined), false);
  assert.equal(looksLikeCumulativeCounter(""), false);
  assert.equal(looksLikeCumulativeCounter("baseline 50-80"), false);
  assert.equal(looksLikeCumulativeCounter("monotonically increasing cumulative counter"), true);
  assert.equal(looksLikeCumulativeCounter("accumulated running total start at 100"), true);
  assert.equal(looksLikeCumulativeCounter("start at 100, then increase each step"), true);
  assert.equal(looksLikeCumulativeCounter("each tick add 360 joules"), true);
});

const POWER_GAUGE_INSTRUCTIONS =
  "per-tick gauge in watts (instantaneous draw, not cumulative). Default range is 800–1800 W. Return a finite number each tick; do not accumulate a running total.";

test("looksLikeCumulativeCounter ignores negated cumulative on gauge instructions", () => {
  assert.equal(looksLikeCumulativeCounter(POWER_GAUGE_INSTRUCTIONS), false);
  assert.equal(inferSamplingKind(POWER_GAUGE_INSTRUCTIONS, "power-consumption_COabc"), "gauge");
});

test("assertPowerEnergySemantics allows power gauge instructions that mention not cumulative", () => {
  const snippet = "const hour = ctx.localHour; return 800 + ctx.uniform01() * 1000;";
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "power-consumption_COabc1234567890123456789012345678",
    mode: "historic",
    frequencySeconds: 300,
    historicStartIso: "2026-04-15T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: POWER_GAUGE_INSTRUCTIONS,
  });
  assert.equal(result.ok, true);
});

const INCIDENT_INSTRUCTIONS =
  "default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily variation and low noise. " +
  "During stress periodes between 08:00-09:00 and 16:00-17:00 create dips down to between 200-300 for periods lasting between 3-10 minutes, at least two dips per stress periode";

const INCIDENT_ACCUMULATION_SNIPPET = `
let value = 0;
const stressPeriods = [[8, 9], [16, 17]];
for (let i = 0; i <= ctx.tickIndex; i++) {
    const currentHour = (ctx.localHour + Math.floor(i * ctx.frequencySeconds / 3600)) % 24;
    let increment;
    if (currentHour >= 6 && currentHour < 18) {
        increment = 500 + ctx.uniformForStep(i) * 500;
    } else {
        increment = 700 + ctx.uniformForStep(i) * 800;
    }
    for (const period of stressPeriods) {
        if (currentHour >= period[0] && currentHour < period[1] && ctx.uniformForStep(i) < 0.5) {
            increment = 200 + ctx.uniformForStep(i) * 100;
            break;
        }
    }
    value += increment;
}
return value;
`.trim();

test("classifiers detect gauge and stress patterns from incident instructions", () => {
  assert.equal(looksLikeGaugeMetric(INCIDENT_INSTRUCTIONS, "p99-token-target_COabc"), true);
  assert.equal(looksLikeStressDipPattern(INCIDENT_INSTRUCTIONS), true);
  assert.equal(looksLikeCumulativeCounter(INCIDENT_INSTRUCTIONS), false);
  assert.equal(inferSamplingKind(INCIDENT_INSTRUCTIONS, "p99-token-target_COabc"), "gauge");
  assert.deepEqual(resolveCodegenModuleNames(INCIDENT_INSTRUCTIONS, "p99-token-target_COabc"), [
    "gauge_codegen",
    "stress_dip_codegen"
  ]);
});

test("snippetLooksLikeAccumulationLoop detects incident snippet", () => {
  assert.equal(snippetLooksLikeAccumulationLoop(INCIDENT_ACCUMULATION_SNIPPET), true);
  assert.equal(snippetLooksLikeAccumulationLoop("return 500 + ctx.uniform01() * 500;"), false);
});

test("validateSnippetSamples rejects incident accumulation snippet", () => {
  const result = validateSnippetSamples({
    snippet: INCIDENT_ACCUMULATION_SNIPPET,
    intentId: "I321e154d744b4210bab04db2b56a35ae",
    compoundMetric: "p99-token-target_COf12213b4cd81427a897fa77bfa7b9d59",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: INCIDENT_INSTRUCTIONS
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /ctx\.tickIndex|running total|accumulate|per-tick gauge/iu);
});

test("validateSnippetSamples rejects dip-free gauge snippet for incident instructions", () => {
  const snippet = `
const hour = ctx.localHour;
let value = 700 + ctx.uniform01() * 800;
if (hour >= 6 && hour < 18) {
  value = 500 + ctx.uniform01() * 500;
}
return value;
`.trim();
  const result = validateSnippetSamples({
    snippet,
    intentId: "I321e154d744b4210bab04db2b56a35ae",
    compoundMetric: "p99-token-target_COf12213b4cd81427a897fa77bfa7b9d59",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-25T05:00:00.000Z",
    instructionsSlice: INCIDENT_INSTRUCTIONS
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /stress-window dip|ctx\.tickInHour/iu);
});

const BUGGY_P99_GLOBAL_TICK_SNIPPET = `
const hour = ctx.localHour;
let value;
if (hour >= 6 && hour < 18) { value = 500 + ctx.uniform01() * 500; } else { value = 700 + ctx.uniform01() * 800; }
const dayIndex = Math.floor(ctx.tickIndex * ctx.frequencySeconds / 86400);
const isStressPeriod = (hour >= 8 && hour < 9) || (hour >= 16 && hour < 17);
if (isStressPeriod) {
  const dipKey = dayIndex * 1000 + (hour >= 8 && hour < 9 ? 0 : 1) * 100 + Math.floor(ctx.uniform01() * 2);
  const dipStartOffset = Math.floor(ctx.uniformForStep(dipKey) * (60 - 3));
  const dipDuration = 3 + Math.floor(ctx.uniformForStep(dipKey + 1) * 8);
  if (ctx.tickIndex >= dipStartOffset && ctx.tickIndex < dipStartOffset + dipDuration) {
    value = 200 + ctx.uniform01() * 100;
  }
}
return value;
`.trim();

test("validateSnippetSamples rejects last-run buggy p99 global tickIndex dip snippet", () => {
  const result = validateSnippetSamples({
    snippet: BUGGY_P99_GLOBAL_TICK_SNIPPET,
    intentId: "If3509db93d1d4bbca70ea562ecc42173",
    compoundMetric: "p99-token-target_CO8ce9f9665a954f738fd7fb4dc9772f61",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-04-15T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: INCIDENT_INSTRUCTIONS
  });
  assert.equal(result.ok, false);
});

const REFERENCE_DIP_SNIPPET = `
const hour = ctx.localHour;
let value = hour >= 6 && hour < 18 ? 500 + ctx.uniform01() * 500 : 700 + ctx.uniform01() * 800;
const isStress = (hour >= 8 && hour < 9) || (hour >= 16 && hour < 17);
if (isStress) {
  const windowId = hour >= 8 && hour < 9 ? 0 : 1;
  const ticksPerHour = Math.ceil(3600 / ctx.frequencySeconds);
  for (let dipIndex = 0; dipIndex < 2; dipIndex += 1) {
    const key = ctx.tickInDay * 1000 + windowId * 100 + dipIndex;
    const dipDuration = 3 + Math.floor(ctx.uniformForStep(key + 1) * 8);
    const maxStart = ticksPerHour - dipDuration;
    const dipStart = Math.floor(ctx.uniformForStep(key) * Math.max(1, maxStart));
    if (ctx.tickInHour >= dipStart && ctx.tickInHour < dipStart + dipDuration) {
      value = 200 + ctx.uniform01() * 100;
      break;
    }
  }
}
return value;
`.trim();

test("validateSnippetSamples accepts reference tickInHour dip implementation", () => {
  const result = validateSnippetSamples({
    snippet: REFERENCE_DIP_SNIPPET,
    intentId: "I321e154d744b4210bab04db2b56a35ae",
    compoundMetric: "p99-token-target_COf12213b4cd81427a897fa77bfa7b9d59",
    mode: "historic",
    frequencySeconds: 60,
    historicStartIso: "2026-04-15T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: INCIDENT_INSTRUCTIONS
  });
  assert.equal(result.ok, true);
});

test("validateSnippetSamples rejects cumulative joules on power-consumption", () => {
  const snippet = `
let total = 5;
for (let i = 1; i <= ctx.tickIndex; i++) { total += 9 * (0.9 + 0.2 * ctx.uniformForStep(i)); }
return total;
`.trim();
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "power-consumption_COabc1234567890123456789012345678",
    mode: "historic",
    frequencySeconds: 300,
    historicStartIso: "2026-04-15T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice:
      "Monotonically increasing cumulative counter. Start at 5. add increment = 300 * f joules each tick."
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /energy-consumption/iu);
});

test("validateSnippetSamples rejects per-tick gauge when start-at-then-increase phrasing used", () => {
  const snippet = "return 100 + 360 * (0.9 + 0.2 * ctx.uniform01());";
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "some_metric_COabc",
    mode: "historic",
    frequencySeconds: 360,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: "start at 100, then increase each step"
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /decreases between tick/u);
});

test("validateSnippetSamples rejects per-tick gauge when instructions request cumulative", () => {
  const snippet = "return 100 + 360 * (0.9 + 0.2 * ctx.uniform01());";
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "container_cpu_joules_total_COabc",
    mode: "historic",
    frequencySeconds: 360,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: "cumulative counter start at 100"
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /decreases between tick/u);
});

test("validateSnippetSamples skips monotonic check without cumulative instructions", () => {
  const snippet = "return 100 + 360 * (0.9 + 0.2 * ctx.uniform01());";
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "some_metric_COabc",
    mode: "historic",
    frequencySeconds: 360,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: "telemetry with random noise each tick"
  });
  assert.equal(result.ok, true);
});

test("validateSnippetSamples accepts running-total loop when instructions request cumulative", () => {
  const snippet = `
let total = 100;
for (let i = 1; i <= ctx.tickIndex; i++) {
  total += 360 * (0.9 + 0.2 * ctx.uniformForStep(i));
}
return total;
`.trim();
  const result = validateSnippetSamples({
    snippet,
    intentId: "I1",
    compoundMetric: "container_cpu_joules_total_COabc",
    mode: "historic",
    frequencySeconds: 360,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice: "monotonically increasing cumulative counter"
  });
  assert.equal(result.ok, true);
});

test("validateSnippetSamples rejects tickIndex-times-increment pattern over full historic window", () => {
  const snippet = "return 100 + ctx.tickIndex * 360 * (0.9 + 0.2 * ctx.uniform01());";
  const result = validateSnippetSamples({
    snippet,
    intentId: "Ia2394317018641f699207402725dfc6a",
    compoundMetric: "some_metric_COabc",
    mode: "historic",
    frequencySeconds: 360,
    historicStartIso: "2026-05-21T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
    instructionsSlice:
      "Monotonically increasing cumulative counter. Start at 100. running total from tick 0 through ctx.tickIndex."
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /decreases between tick/u);
});

test("cumulativeProbeTickCount caps long historic windows for validation", () => {
  const ticks = cumulativeProbeTickCount({
    snippet: "return 0;",
    intentId: "I1",
    compoundMetric: "energy-consumption_COabc",
    mode: "historic",
    frequencySeconds: 300,
    historicStartIso: "2026-04-15T05:00:00.000Z",
    historicEndIso: "2026-05-22T05:00:00.000Z",
  });
  assert.equal(ticks, CUMULATIVE_VALIDATION_PROBE_CAP);
});

test("probeSequentialSnippetValues walks ticks 0..n-1", () => {
  const snippet = "return 100 + ctx.tickIndex * 10;";
  const probe = probeSequentialSnippetValues(
    {
      snippet,
      intentId: "I1",
      compoundMetric: "container_cpu_joules_total_COabc",
      mode: "historic",
      frequencySeconds: 360,
      historicStartIso: "2026-05-21T05:00:00.000Z",
      historicEndIso: "2026-05-22T05:00:00.000Z"
    },
    5
  );
  assert.equal(probe.ok, true);
  if (!probe.ok) return;
  assert.deepEqual(probe.values, [100, 110, 120, 130, 140]);
});
