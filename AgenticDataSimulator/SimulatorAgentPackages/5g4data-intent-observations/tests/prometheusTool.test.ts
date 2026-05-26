import test from "node:test";
import assert from "node:assert/strict";

import { PrometheusTool } from "../tools/prometheusTool.js";
import { prometheusRemoteWriteUrl } from "../tools/prometheusRemoteWrite.js";

test("formatSample includes timestamp_ms when provided", () => {
  const tool = PrometheusTool.fromEnv("http://pg:9091", "http://127.0.0.1:9090/prometheus");
  const line = tool.formatSample({
    metricName: "p99tokentarget_COabc",
    value: 42.5,
    labels: { job: "intent_reports", intent_id: "I1" },
    timestampMs: 1_700_000_000_000
  });
  assert.match(line, /p99tokentarget_COabc\{job="intent_reports",intent_id="I1"\} 42\.5 1700000000000/);
});

test("formatSample omits timestamp when not provided", () => {
  const tool = PrometheusTool.fromEnv("http://pg:9091", "http://127.0.0.1:9090/prometheus");
  const line = tool.formatSample({
    metricName: "metric_a",
    value: 1,
    labels: { job: "intent_reports" }
  });
  assert.equal(line, 'metric_a{job="intent_reports"} 1\n');
});

test("pushSample POST body includes timestamp suffix", async () => {
  const originalFetch = globalThis.fetch;
  let postedBody = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postedBody = String(init?.body ?? "");
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const tool = PrometheusTool.fromEnv("http://pg:9091", "http://127.0.0.1:9090/prometheus");
    const ok = await tool.pushSample({
      metricName: "metric_a",
      value: 9,
      labels: { job: "intent_reports" },
      timestampMs: 1_700_000_000_123
    });
    assert.equal(ok, true);
    assert.match(postedBody, / 9 1700000000123\n$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pushSample uses intent_id grouping path when label is present", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestUrl = String(input);
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const tool = PrometheusTool.fromEnv("http://pg:9091", "http://127.0.0.1:9090/prometheus");
    const ok = await tool.pushSample({
      metricName: "metric_a",
      value: 9,
      labels: { job: "intent_reports", intent_id: "Iabc123" },
    });
    assert.equal(ok, true);
    assert.equal(
      requestUrl,
      "http://pg:9091/metrics/job/intent_reports/intent_id/Iabc123"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fromEnv derives remote write URL from prometheus base", () => {
  const url = prometheusRemoteWriteUrl(
    undefined,
    PrometheusTool.fromEnv("http://pg:9091", "http://127.0.0.1:9090/prometheus").prometheusQueryBaseUrl
  );
  assert.equal(url, "http://127.0.0.1:9090/prometheus/api/v1/write");
});
