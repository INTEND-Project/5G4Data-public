import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrometheusInstantQueryUrl,
  buildPrometheusReadableQuery,
  toPrometheusMetricName
} from "../tools/prometheusMetricNaming.js";

test("toPrometheusMetricName strips hyphens from intent compound metrics", () => {
  assert.equal(
    toPrometheusMetricName("p99-token-target_COe5997c5a04ee4bd18edcc6cb4eb2e31a"),
    "p99tokentarget_COe5997c5a04ee4bd18edcc6cb4eb2e31a"
  );
});

test("buildPrometheusReadableQuery matches IntentReport-Simulator label shape", () => {
  const q = buildPrometheusReadableQuery({
    compoundMetric: "p99-token-target_COe5997c5a04ee4bd18edcc6cb4eb2e31a",
    intentId: "Id15cce0eab994812a66d6ad75f5c5982",
    conditionId: "COe5997c5a04ee4bd18edcc6cb4eb2e31a"
  });
  assert.equal(
    q,
    'p99tokentarget_COe5997c5a04ee4bd18edcc6cb4eb2e31a{job="intent_reports",intent_id="Id15cce0eab994812a66d6ad75f5c5982",condition_id="COe5997c5a04ee4bd18edcc6cb4eb2e31a"}'
  );
});

test("buildPrometheusInstantQueryUrl encodes query for metadata storage", () => {
  const url = buildPrometheusInstantQueryUrl("http://prom:9090/prometheus", {
    compoundMetric: "latency_COb1b2c3d4e5f678901234567890abcd",
    intentId: "Iabc",
    conditionId: "COb1b2c3d4e5f678901234567890abcd"
  });
  assert.match(url, /^http:\/\/prom:9090\/prometheus\/api\/v1\/query\?query=/);
  assert.match(decodeURIComponent(url.split("query=")[1] ?? ""), /latency_COb1b2c3d4e5f678901234567890abcd\{/);
});
