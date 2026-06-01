import test from "node:test";
import assert from "node:assert/strict";

import {
  createPrometheusObservationBackend,
  flushBufferedPrometheusRemoteWrite,
  obtainedAtToMs,
  resetPrometheusBufferForTests
} from "../tools/observationStorage/prometheusBackend.js";
import type { ObservationPersistContext } from "../tools/observationStorage/persistContext.js";

test("obtainedAtToMs parses ISO timestamps", () => {
  const ms = obtainedAtToMs("2026-05-17T05:00:00Z");
  assert.equal(ms, Date.parse("2026-05-17T05:00:00Z"));
  assert.equal(obtainedAtToMs(""), undefined);
});

test("buffer mode accumulates and flush calls remote write once", async () => {
  resetPrometheusBufferForTests();
  const originalFetch = globalThis.fetch;
  let remoteWriteCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/write")) {
      remoteWriteCalls += 1;
      return new Response("", { status: 200 });
    }
    if (url.includes("pushgateway") || url.includes("9091")) {
      return new Response("", { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  try {
    const backend = createPrometheusObservationBackend(
      "http://127.0.0.1:9091",
      "http://127.0.0.1:9090/prometheus",
      "http://127.0.0.1:9090/prometheus/api/v1/write"
    );

    const baseCtx = {
      graphTool: {
        storePrometheusMetadata: async () => true
      },
      payload: {
        observationId: "OB1",
        observedMetric: "p99-token-target_COabc",
        value: 10,
        unit: "NA",
        obtainedAt: "2026-05-17T05:00:00Z"
      },
      turtle: "",
      intentId: "Iabc",
      compoundMetric: "p99-token-target_COabc",
      conditionId: "COabc",
      unit: "NA"
    } satisfies Omit<ObservationPersistContext, "storageId" | "prometheusWriteMode">;

    const pushCtx: ObservationPersistContext = {
      ...baseCtx,
      storageId: "prometheus",
      prometheusWriteMode: "push"
    };
    assert.equal(await backend.persistObservation(pushCtx), true);

    const bufferCtx: ObservationPersistContext = {
      ...baseCtx,
      storageId: "prometheus",
      prometheusWriteMode: "buffer",
      payload: { ...baseCtx.payload, value: 20, obtainedAt: "2026-05-17T05:01:00Z" }
    };
    assert.equal(await backend.persistObservation(bufferCtx), true);
    assert.equal(await backend.persistObservation(bufferCtx), true);

    assert.equal(remoteWriteCalls, 0);
    const flushResult = await flushBufferedPrometheusRemoteWrite({
      intentId: "Iabc",
      metric: "p99-token-target_COabc",
    });
    assert.equal(flushResult.ok, true);
    assert.equal(flushResult.sampleCount, 2);
    assert.equal(remoteWriteCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetPrometheusBufferForTests();
  }
});
