import test from "node:test";
import assert from "node:assert/strict";
import {
  argLocalFromMetricStem,
  buildSubUtilitySpecs,
  computeMidpointQuantity,
  computeSignedK,
  expectationPrefixForMetricStem,
  isNetworkMetricStem,
  metricStemFromScopedLocal,
  metricStemsAlignForCoordination,
  resolveLimits,
  resolveSeverity,
  resolveWeightProfile,
  severityParams,
} from "../tools/postprocess/coordinationUtilityDerive.js";
import type { ParsedCoordinationCondition } from "../tools/postprocess/coordinationUtilityDerive.js";

const tpsCondition: ParsedCoordinationCondition = {
  local: "COabc",
  metricLocal: "data5g:p99-tps-target_COabc",
  metricStem: "p99-tps-target",
  quantifier: "atLeast",
  threshold: 400,
  unit: "tokens/s",
};

const energyCondition: ParsedCoordinationCondition = {
  local: "COdef",
  metricLocal: "data5g:energy-consumption_COdef",
  metricStem: "energy-consumption",
  quantifier: "smaller",
  threshold: 10000,
  unit: "J",
};

test("metricStemFromScopedLocal strips CO suffix", () => {
  assert.equal(
    metricStemFromScopedLocal("data5g:p99-tps-target_COabc123"),
    "p99-tps-target",
  );
});

test("argLocalFromMetricStem builds U_arg name", () => {
  assert.equal(argLocalFromMetricStem("p99-tps-target"), "U_arg_p99-tps-target");
});

test("resolveWeightProfile prefers weighted when both flags set", () => {
  assert.equal(
    resolveWeightProfile({ coordinationSymmetric: true, coordinationWeighted: true }),
    "weighted",
  );
});

test("symmetric profile assigns equal limits", () => {
  const limits = resolveLimits(
    [tpsCondition, energyCondition],
    "symmetric",
    "symmetric coordination",
  );
  assert.equal(limits[0], 0.5);
  assert.equal(limits[1], 0.5);
});

test("weighted profile assigns higher limit to prioritized metric", () => {
  const limits = resolveLimits(
    [tpsCondition, energyCondition],
    "weighted",
    "weighted coordination prioritizing throughput over energy",
  );
  assert.equal(limits[0], 0.7);
  assert.equal(limits[1], 0.3);
});

test("severity maps to standardK and x0Fraction", () => {
  assert.deepEqual(severityParams(resolveSeverity({ coordinationSeverityCritical: true })), {
    standardK: 30,
    x0Fraction: 0.95,
  });
  assert.deepEqual(severityParams(resolveSeverity({ coordinationSeverityTrivial: true })), {
    standardK: 5,
    x0Fraction: 0.8,
  });
});

test("computeMidpointQuantity uses atLeast vs smaller formulas", () => {
  assert.equal(computeMidpointQuantity("atLeast", 400, 0.85, "tokens/s"), 340);
  assert.equal(computeMidpointQuantity("smaller", 10000, 0.85, "J"), 11500);
});

test("computeSignedK sign follows quantifier", () => {
  assert.ok(computeSignedK("atLeast", 400, 12) > 0);
  assert.ok(computeSignedK("smaller", 10000, 12) < 0);
});

test("expectationPrefixForMetricStem maps metric families to expectation types", () => {
  assert.equal(expectationPrefixForMetricStem("p99-token-target"), "DE");
  assert.equal(expectationPrefixForMetricStem("energy-consumption"), "SE");
  assert.equal(expectationPrefixForMetricStem("bandwidth"), "NE");
  assert.equal(expectationPrefixForMetricStem("latency"), "NE");
  assert.equal(metricStemsAlignForCoordination("energy-consumption", "power-consumption"), true);
  assert.equal(metricStemsAlignForCoordination("p99-token-target", "power-consumption"), false);
  assert.equal(isNetworkMetricStem("networklatency"), true);
  assert.equal(isNetworkMetricStem("p99-token-target"), false);
});

test("buildSubUtilitySpecs uses poly for secondary energy in weighted profile", () => {
  const specs = buildSubUtilitySpecs(
    [tpsCondition, energyCondition],
    { coordinationWeighted: true },
    "weighted coordination prioritizing throughput",
  );
  assert.equal(specs[0].mfFunction, "logistic");
  assert.equal(specs[1].mfFunction, "poly");
  assert.equal(specs[0].argLocal, "U_arg_p99-tps-target");
  assert.equal(specs[1].argLocal, "U_arg_energy-consumption");
});
