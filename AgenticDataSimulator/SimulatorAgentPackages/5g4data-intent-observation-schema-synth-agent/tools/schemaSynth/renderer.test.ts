import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseConstraintDocument } from "./schema/types.js";
import { createMetricSampler, renderConstraintDocument } from "./render/renderer.js";
import { validateAllSeries } from "./validate/validateSeries.js";

const root = dirname(fileURLToPath(import.meta.url));

test("p99 stress fixture renders 24h of 60s samples and validates", () => {
  const doc = parseConstraintDocument(
    JSON.parse(readFileSync(join(root, "fixtures/p99-stress.json"), "utf8"))
  );
  const series = renderConstraintDocument(doc);
  assert.equal(series.length, 1);
  assert.equal(series[0].samples.length, 24 * 60);
  const validation = validateAllSeries(doc, series);
  assert.equal(validation.ok, true, JSON.stringify(validation.checks.filter((c) => !c.ok), null, 2));
});

test("validateSeries fails when dips removed", () => {
  const doc = parseConstraintDocument(
    JSON.parse(readFileSync(join(root, "fixtures/p99-stress.json"), "utf8"))
  );
  const series = renderConstraintDocument(doc);
  for (const s of series[0].samples) {
    s.value = 700;
  }
  const validation = validateAllSeries(doc, series);
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((c) => !c.ok && c.id.includes("episode")));
});

test("ar1 diurnal fixture stays in band and passes smoke checks", () => {
  const doc = parseConstraintDocument(
    JSON.parse(readFileSync(join(root, "fixtures/latency-ar1.json"), "utf8"))
  );
  const series = renderConstraintDocument(doc);
  for (const s of series[0].samples) {
    assert.ok(s.value >= 5 && s.value <= 80);
  }
  const validation = validateAllSeries(doc, series);
  assert.equal(validation.ok, true, JSON.stringify(validation.checks.filter((c) => !c.ok), null, 2));
});

test("streaming sampler counter is monotonic across ticks", () => {
  const doc = parseConstraintDocument({
    version: 1,
    samplingKind: "counter",
    timeline: {
      mode: "streaming",
      frequencySeconds: 60
    },
    metrics: [{ name: "energy-consumption" }],
    counter: { startAt: 100, increment: { min: 5, max: 15 } },
    seed: 7
  });
  const sampler = createMetricSampler(doc, "energy-consumption", { seedOverride: 7 });
  let prev = -Infinity;
  const base = Date.parse("2026-05-21T05:00:00Z");
  for (let i = 0; i < 50; i += 1) {
    const v = sampler.sample(base + i * 60_000);
    assert.ok(v >= prev - 1e-9, `tick ${i}: ${v} < ${prev}`);
    prev = v;
  }
});

test("streaming sampler AR1 state is continuous (not reset each tick)", () => {
  const doc = parseConstraintDocument({
    version: 1,
    samplingKind: "gauge",
    timeline: { mode: "streaming", frequencySeconds: 60 },
    metrics: [{ name: "network-latency" }],
    defaultBand: { min: 5, max: 80 },
    level: { mean: 25 },
    residual: { type: "ar1", sigma: 2, phi: 0.9 },
    noise: "none",
    seed: 99
  });
  const sampler = createMetricSampler(doc, "network-latency", { seedOverride: 99 });
  const base = Date.parse("2026-05-21T12:00:00Z");
  const values: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    values.push(sampler.sample(base + i * 60_000));
  }
  // lag-1 correlation of successive samples should be positive with phi=0.9
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - mean;
    den += d * d;
    if (i > 0) num += (values[i - 1] - mean) * d;
  }
  const ac = den === 0 ? 0 : num / den;
  assert.ok(ac > 0.2, `expected positive AR1 autocorr, got ${ac}`);
});
