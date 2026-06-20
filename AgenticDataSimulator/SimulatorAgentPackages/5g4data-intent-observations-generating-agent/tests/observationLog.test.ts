import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendGeneratedObservation,
  capObservationLogFile,
  resetObservationLogAppendCountersForTests,
  appendObservationError,
  DEFAULT_OBS_LOG_N,
  observationLogPathForMetric,
  observationProgramPathForMetric,
  resolveObsLogMaxEntries,
  sanitizeMetricForLogFilename,
  writeObservationProgramLog
} from "../tools/observationLog.js";

test("appendGeneratedObservation writes one NDJSON line per observation", () => {
  const prev = process.env.OBSERVATION_LOG_PATH;
  const dir = mkdtempSync(join(tmpdir(), "obs-log-"));
  process.env.OBSERVATION_LOG_PATH = dir;
  try {
    const returned = appendGeneratedObservation(
      {
        source: "stream",
        sessionId: "sess-1",
        intentId: "I1",
        metric: "throughput_COabc",
        observationId: "OBabc",
        value: 42.5,
        unit: "mbit/s",
        obtainedAt: "2026-05-20T12:00:00Z",
        turtle: "@prefix data5g: <http://5g4data.eu/5g4data#> .\n",
        graphDbWritten: true,
        frequencySeconds: 60
      }
    );
    assert.ok(returned.endsWith("observations-throughput_COabc.ndjson"));
    const raw = readFileSync(returned, "utf8").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, "observation_v1");
    assert.equal(parsed.source, "stream");
    assert.equal(parsed.sessionId, "sess-1");
    assert.equal(parsed.metric, "throughput_COabc");
    assert.equal(parsed.graphDbWritten, true);
    assert.equal(parsed.frequencySeconds, 60);
  } finally {
    if (prev === undefined) delete process.env.OBSERVATION_LOG_PATH;
    else process.env.OBSERVATION_LOG_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("observationLogPathForMetric includes sanitized metric in filename", () => {
  const prev = process.env.OBSERVATION_LOG_PATH;
  const dir = mkdtempSync(join(tmpdir(), "obs-log-dir-"));
  process.env.OBSERVATION_LOG_PATH = dir;
  try {
    assert.equal(sanitizeMetricForLogFilename("data5g:metricA_COone"), "metricA_COone");
    const p = observationLogPathForMetric("metricA_COone");
    assert.ok(p.endsWith("observations-metricA_COone.ndjson"));
    assert.ok(p.startsWith(dir));
  } finally {
    if (prev === undefined) delete process.env.OBSERVATION_LOG_PATH;
    else process.env.OBSERVATION_LOG_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveObsLogMaxEntries defaults to 100", () => {
  const prev = process.env.OBS_LOG_N;
  delete process.env.OBS_LOG_N;
  try {
    assert.equal(resolveObsLogMaxEntries(), DEFAULT_OBS_LOG_N);
    assert.equal(DEFAULT_OBS_LOG_N, 100);
  } finally {
    if (prev === undefined) delete process.env.OBS_LOG_N;
    else process.env.OBS_LOG_N = prev;
  }
});

test("appendGeneratedObservation keeps only the last maxEntries lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-log-cap-"));
  resetObservationLogAppendCountersForTests();
  try {
    const metric = "cap_test_COabc";
    const logPath = join(dir, `observations-${metric}.ndjson`);
    for (let i = 0; i < 5; i += 1) {
      appendGeneratedObservation(
        {
          source: "stream",
          metric,
          observationId: `OB${i}`,
          value: i,
          unit: "NA",
          obtainedAt: "2026-05-20T12:00:00Z",
          turtle: "",
          graphDbWritten: false
        },
        logPath,
        3
      );
    }
    capObservationLogFile(logPath, 3);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0] as string).value, 2);
    assert.equal(JSON.parse(lines[2] as string).value, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeObservationProgramLog stores sampler body with metric in filename", () => {
  const prev = process.env.OBSERVATION_LOG_PATH;
  const dir = mkdtempSync(join(tmpdir(), "obs-log-prog-"));
  process.env.OBSERVATION_LOG_PATH = dir;
  try {
    const metric = "latency_COdeadbeefdeadbeefdeadbeefdeadbe";
    const body = "return ctx.uniform01() * 100;";
    const path = writeObservationProgramLog({
      metric,
      program: body,
      intentId: "I1",
      mode: "streaming",
      frequencySeconds: 60
    });
    assert.equal(path, observationProgramPathForMetric(metric));
    const text = readFileSync(path, "utf8");
    assert.ok(text.includes("// metric: latency_COdeadbeefdeadbeefdeadbeefdeadbe"));
    assert.ok(text.includes(body));
  } finally {
    if (prev === undefined) delete process.env.OBSERVATION_LOG_PATH;
    else process.env.OBSERVATION_LOG_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendObservationError writes persistent NDJSON error log", () => {
  const prev = process.env.OBSERVATION_LOG_PATH;
  const dir = mkdtempSync(join(tmpdir(), "obs-log-err-"));
  process.env.OBSERVATION_LOG_PATH = dir;
  try {
    appendObservationError({
      kind: "prometheus_remote_write_flush_failed",
      message: "Prometheus remote write flush failed for 100 buffered samples",
      intentId: "Iabc",
      metric: "p99-token-target_COabc",
      sampleCount: 100,
    });
    const raw = readFileSync(join(dir, "observation-errors.ndjson"), "utf8").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, "observation_error_v1");
    assert.equal(parsed.kind, "prometheus_remote_write_flush_failed");
    assert.equal(parsed.metric, "p99-token-target_COabc");
    assert.equal(parsed.sampleCount, 100);
  } finally {
    if (prev === undefined) delete process.env.OBSERVATION_LOG_PATH;
    else process.env.OBSERVATION_LOG_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendGeneratedObservation skips writes when maxEntries is 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "obs-log-off-"));
  const logPath = join(dir, "observations-throughput_COabc.ndjson");
  try {
    appendGeneratedObservation(
      {
        source: "synthetic",
        metric: "m0",
        observationId: "OB0",
        value: 1,
        unit: "NA",
        obtainedAt: "2026-05-20T12:00:00Z",
        turtle: "",
        graphDbWritten: true
      },
      logPath,
      0
    );
    assert.throws(() => readFileSync(logPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
