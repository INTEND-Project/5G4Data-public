import assert from "node:assert/strict";
import test from "node:test";

import {
  applySessionPrometheusBinding,
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

test("local stack uses push for streaming and buffer for historic", () => {
  applySessionPrometheusBinding({
    prometheusBaseUrl: "http://127.0.0.1:9090",
    prometheusStorageMode: "local",
  });
  assert.equal(usesRemoteWriteForStreaming(), false);
  assert.equal(resolvePrometheusWriteMode("streaming", true), "push");
  assert.equal(resolvePrometheusWriteMode("historic", true), "buffer");
});
