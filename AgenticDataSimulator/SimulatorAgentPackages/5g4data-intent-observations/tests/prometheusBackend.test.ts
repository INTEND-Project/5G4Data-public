import test from "node:test";
import assert from "node:assert/strict";

import {
  bufferPrometheusSample,
  createPrometheusObservationBackend,
  flushBufferedPrometheusRemoteWrite,
  flushBufferedPrometheusRemoteWriteChunk,
  obtainedAtToMs,
  prometheusSampleFromParts,
  readPrometheusFlushChunkSize,
  resetPrometheusBufferForTests,
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
  globalThis.fetch = (async (input: RequestInfo | URL) => {
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

test("chunked flush remote-writes in multiple batches", async () => {
  resetPrometheusBufferForTests();
  const originalFetch = globalThis.fetch;
  let remoteWriteCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/write")) {
      remoteWriteCalls += 1;
      return new Response("", { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  try {
    createPrometheusObservationBackend(
      undefined,
      "http://127.0.0.1:9090",
      "http://127.0.0.1:9090/api/v1/write",
    );

    for (let i = 0; i < 25; i += 1) {
      bufferPrometheusSample(
        prometheusSampleFromParts({
          compoundMetric: "m_COabc",
          intentId: "Iabc",
          conditionId: "COabc",
          unit: "NA",
          value: i,
          obtainedAt: `2026-05-17T05:${String(i).padStart(2, "0")}:00Z`,
        }),
      );
    }

    const chunkSize = 10;
    let total = 0;
    while (true) {
      const result = await flushBufferedPrometheusRemoteWriteChunk(
        { intentId: "Iabc", metric: "m_COabc" },
        { chunkSize },
      );
      assert.equal(result.ok, true);
      total += result.sampleCount;
      if (result.remainingBuffered < chunkSize) {
        break;
      }
    }
    const remainder = await flushBufferedPrometheusRemoteWriteChunk(
      { intentId: "Iabc", metric: "m_COabc" },
      { force: true },
    );
    assert.equal(remainder.ok, true);
    total += remainder.sampleCount;

    assert.equal(total, 25);
    assert.equal(remoteWriteCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    resetPrometheusBufferForTests();
  }
});

test("readPrometheusFlushChunkSize respects env", () => {
  const prev = process.env.SYNTH_OBS_PROM_FLUSH_CHUNK;
  process.env.SYNTH_OBS_PROM_FLUSH_CHUNK = "5000";
  try {
    assert.equal(readPrometheusFlushChunkSize(), 5000);
  } finally {
    if (prev === undefined) delete process.env.SYNTH_OBS_PROM_FLUSH_CHUNK;
    else process.env.SYNTH_OBS_PROM_FLUSH_CHUNK = prev;
  }
});
