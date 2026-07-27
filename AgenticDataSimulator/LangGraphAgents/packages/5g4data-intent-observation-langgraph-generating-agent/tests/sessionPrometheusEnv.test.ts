import assert from "node:assert/strict";
import test from "node:test";

import {
  applySessionPrometheusBinding,
  prometheusRemoteWriteUrlForRuntime,
  resolvePrometheusWriteMode,
  usesRemoteWriteForStreaming,
} from "../tools/sessionPrometheusEnv.js";

test("external stack uses remote-write buffer for streaming", () => {
  applySessionPrometheusBinding({
    prometheusBaseUrl: "https://partner.example/prometheus",
    prometheusStorageMode: "external",
  });
  assert.equal(usesRemoteWriteForStreaming(), true);
  assert.equal(resolvePrometheusWriteMode("streaming", true), "buffer");
  assert.equal(resolvePrometheusWriteMode("historic", true), "buffer");
});

test("container runtime rewrites loopback remote-write URL to host.docker.internal", () => {
  const prev = process.env.SIMULATOR_AGENT_CONTAINER;
  process.env.SIMULATOR_AGENT_CONTAINER = "true";
  try {
    assert.equal(
      prometheusRemoteWriteUrlForRuntime("http://127.0.0.1:9090"),
      "http://host.docker.internal:9090/api/v1/write",
    );
    applySessionPrometheusBinding({
      prometheusBaseUrl: "http://127.0.0.1:9090/prometheus",
      prometheusStorageMode: "local",
    });
    assert.equal(process.env.PROMETHEUS_URL, "http://127.0.0.1:9090/prometheus");
    assert.equal(
      process.env.PROMETHEUS_REMOTE_WRITE_URL,
      "http://host.docker.internal:9090/prometheus/api/v1/write",
    );
  } finally {
    if (prev === undefined) {
      delete process.env.SIMULATOR_AGENT_CONTAINER;
    } else {
      process.env.SIMULATOR_AGENT_CONTAINER = prev;
    }
  }
});

test("local stack uses push for streaming and buffer for historic", () => {
  applySessionPrometheusBinding({
    prometheusBaseUrl: "http://127.0.0.1:9090",
    prometheusStorageMode: "local",
  });
  assert.equal(usesRemoteWriteForStreaming(), false);
  assert.equal(resolvePrometheusWriteMode("streaming", true), "push");
  assert.equal(resolvePrometheusWriteMode("historic", true), "buffer");
});
