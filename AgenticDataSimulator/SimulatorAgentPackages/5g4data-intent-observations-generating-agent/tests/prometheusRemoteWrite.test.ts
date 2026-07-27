import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeRemoteWriteBody,
  postRemoteWrite,
  prometheusRemoteWriteUrl
} from "../tools/prometheusRemoteWrite.js";

test("prometheusRemoteWriteUrl derives from prometheus base", () => {
  assert.equal(
    prometheusRemoteWriteUrl(undefined, "http://127.0.0.1:9090/prometheus"),
    "http://127.0.0.1:9090/prometheus/api/v1/write"
  );
  assert.equal(
    prometheusRemoteWriteUrl("http://custom/write", "http://ignored"),
    "http://custom/write"
  );
});

test("encodeRemoteWriteBody returns non-empty snappy-compressed bytes", () => {
  const body = encodeRemoteWriteBody([
    {
      metricName: "p99tokentarget_COabc",
      value: 100,
      labels: { job: "intent_reports", intent_id: "I1", condition_id: "COabc" },
      timestampMs: 1_700_000_000_000
    },
    {
      metricName: "p99tokentarget_COabc",
      value: 200,
      labels: { job: "intent_reports", intent_id: "I1", condition_id: "COabc" },
      timestampMs: 1_700_000_060_000
    }
  ]);
  assert.ok(body.length > 20);
});

test("postRemoteWrite sends protobuf snappy request", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let contentType = "";
  let contentEncoding = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    contentType = String(init?.headers && (init.headers as Record<string, string>)["Content-Type"]);
    contentEncoding = String(
      init?.headers && (init.headers as Record<string, string>)["Content-Encoding"]
    );
    return new Response("", { status: 204 });
  }) as typeof fetch;

  try {
    const ok = await postRemoteWrite("http://127.0.0.1:9090/prometheus/api/v1/write", [
      {
        metricName: "metric_a",
        value: 1,
        labels: { job: "intent_reports" },
        timestampMs: 1_700_000_000_000
      }
    ]);
    assert.equal(ok, true);
    assert.match(seenUrl, /\/api\/v1\/write$/);
    assert.equal(contentType, "application/x-protobuf");
    assert.equal(contentEncoding, "snappy");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postRemoteWrite throws with HTTP status when Prometheus rejects samples", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("out of bounds", { status: 400 })) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        postRemoteWrite("http://127.0.0.1:9090/prometheus/api/v1/write", [
          {
            metricName: "metric_a",
            value: 1,
            labels: { job: "intent_reports" },
            timestampMs: 1_700_000_000_000
          }
        ]),
      /HTTP 400: out of bounds/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
