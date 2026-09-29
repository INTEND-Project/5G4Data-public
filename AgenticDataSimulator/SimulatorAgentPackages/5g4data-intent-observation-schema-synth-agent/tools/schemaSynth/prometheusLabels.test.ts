import assert from "node:assert/strict";
import test from "node:test";
import { prometheusQueryLabels, toPrometheusMetricName } from "../prometheusMetricNaming.js";

test("production prometheus labels use intent_reports job", () => {
  const labels = prometheusQueryLabels({
    compoundMetric: "p99-token-target_COe5997c5a04ee4bd18edcc6cb4eb2e31a",
    intentId: "Id15cce0eab994812a66d6ad75f5c5982",
    conditionId: "COe5997c5a04ee4bd18edcc6cb4eb2e31a"
  });
  assert.equal(labels.job, "intent_reports");
  assert.equal(labels.intent_id, "Id15cce0eab994812a66d6ad75f5c5982");
  assert.equal(labels.condition_id, "COe5997c5a04ee4bd18edcc6cb4eb2e31a");
  assert.equal(
    toPrometheusMetricName("p99-token-target_COe5997c5a04ee4bd18edcc6cb4eb2e31a"),
    "p99tokentarget_COe5997c5a04ee4bd18edcc6cb4eb2e31a"
  );
});
