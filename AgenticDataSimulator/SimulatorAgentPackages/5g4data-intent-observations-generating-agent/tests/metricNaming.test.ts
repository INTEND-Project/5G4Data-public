import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCompoundMetricAgainstIntent,
  resolveConditionScopedMetricName
} from "../tools/metricNaming.js";

test("resolveConditionScopedMetricName preserves exact valuesOfTargetProperty compound local", () => {
  const resolved = resolveConditionScopedMetricName({
    valuesOfTargetPropertyLocal: "p99-token-target_COe8af1c5b33734c109cf68d0025998898",
    conditionId: "COe8af1c5b33734c109cf68d0025998898"
  });
  assert.equal(resolved.targetProperty, "p99-token-target");
  assert.equal(resolved.compoundMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
});

test("resolveConditionScopedMetricName builds compound from stem-only property", () => {
  const resolved = resolveConditionScopedMetricName({
    valuesOfTargetPropertyLocal: "p99-token-target",
    conditionId: "COe8af1c5b33734c109cf68d0025998898"
  });
  assert.equal(resolved.compoundMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
});

test("resolveConditionScopedMetricName keeps hyphenated metric stems", () => {
  const resolved = resolveConditionScopedMetricName({
    valuesOfTargetPropertyLocal: "energy-consumption_CO72a1524ea1904d429ecd23cc1c536d1c",
    conditionId: "CO72a1524ea1904d429ecd23cc1c536d1c"
  });
  assert.equal(resolved.compoundMetric, "energy-consumption_CO72a1524ea1904d429ecd23cc1c536d1c");
});

test("resolveCompoundMetricAgainstIntent returns exact GraphDB compound metric", () => {
  const intentMetrics = ["p99-token-target_COe8af1c5b33734c109cf68d0025998898"];
  assert.equal(
    resolveCompoundMetricAgainstIntent("p99-token-target_COe8af1c5b33734c109cf68d0025998898", intentMetrics),
    "p99-token-target_COe8af1c5b33734c109cf68d0025998898"
  );
});

test("resolveCompoundMetricAgainstIntent maps user variant to GraphDB metric by condition id", () => {
  const intentMetrics = ["p99-token-target_COe8af1c5b33734c109cf68d0025998898"];
  assert.equal(
    resolveCompoundMetricAgainstIntent("p99_token_target_COe8af1c5b33734c109cf68d0025998898", intentMetrics),
    "p99-token-target_COe8af1c5b33734c109cf68d0025998898"
  );
});

test("resolveCompoundMetricAgainstIntent returns null for unknown metrics", () => {
  const intentMetrics = ["p99-token-target_COe8af1c5b33734c109cf68d0025998898"];
  assert.equal(resolveCompoundMetricAgainstIntent("bandwidth_COabc1234567890123456789012345678", intentMetrics), null);
});
