/**
 * Per-metric child process: loads ConstraintDocument JSON, samples via schema-synth
 * renderer (historic batch or wall-clock streaming), publishes observations.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { GraphDbTool } from "./graphdbTool.js";
import { ObservationTool, type ObservationPayload } from "./observationTool.js";
import { persistObservationWithStorage, registerObservationMetadataForMetric } from "./persistObservation.js";
import {
  bufferPrometheusSample,
  bufferedPrometheusSampleCount,
  flushBufferedPrometheusRemoteWrite,
  flushBufferedPrometheusRemoteWriteChunk,
  initPrometheusSampleBuffer,
  prometheusSampleFromParts,
  readPrometheusFlushChunkSize,
} from "./observationStorage/prometheusBackend.js";
import type { ObservationStorageId } from "./observationStorageTypes.js";
import { resolvePrometheusWriteMode } from "./sessionPrometheusEnv.js";
import { resolveObservationStorageTypes } from "./resolveObservationStorage.js";
import {
  markMetricCompleted,
  markMetricFailed,
  reportWorkerTickProgress,
} from "./observationProgress.js";
import {
  createMetricSampler,
  parseConstraintDocument,
  type ConstraintDocument,
  type MetricSampler,
} from "./schemaSynth/index.js";
import {
  validateMetricSeries,
  type ValidationCheck,
} from "./schemaSynth/validate/validateSeries.js";
import { appendObservationError } from "./observationLog.js";

export interface SchemaSynthMetricWorkerConfig {
  compoundMetric: string;
  unit: string;
  intentId: string;
  mode: "streaming" | "historic";
  frequencySeconds: number;
  constraintPath: string;
  historicStartIso?: string;
  historicEndIso?: string;
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
  repositoryBaseUrl?: string;
  timezoneHint?: string;
  conditionId: string;
  storageTypes: ObservationStorageId[];
  observationStorageOverride?: ObservationStorageId | null;
  createIntentStorage?: ObservationStorageId | null;
  sessionId?: string;
  ticksTotal?: number | null;
  /** Soft-fail validation warnings are logged; hard checks abort historic flush. */
  validateBeforeFlush?: boolean;
  /** When true, emit JSON sample lines on stdout for parent intent-status evaluation. */
  emitStatusSampleEvents?: boolean;
}

function emitStatusSampleEvent(
  cfg: SchemaSynthMetricWorkerConfig,
  timestampMs: number,
  value: number,
): void {
  if (!cfg.emitStatusSampleEvents) return;
  process.stdout.write(
    `${JSON.stringify({
      type: "sample",
      metric: cfg.compoundMetric,
      timestampMs,
      value,
      conditionId: cfg.conditionId,
    })}\n`,
  );
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw !== undefined ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function loadCfg(path: string): SchemaSynthMetricWorkerConfig {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as SchemaSynthMetricWorkerConfig;
}

function loadConstraint(path: string): ConstraintDocument {
  return parseConstraintDocument(JSON.parse(readFileSync(path, "utf8")));
}

function isPrometheusOnlyHistoric(
  cfg: SchemaSynthMetricWorkerConfig,
  storageIds: ObservationStorageId[],
): boolean {
  return (
    cfg.mode === "historic" &&
    storageIds.length === 1 &&
    storageIds[0] === "prometheus"
  );
}

async function insertOrPrint(
  graphDb: GraphDbTool,
  payload: ObservationPayload,
  ttl: string,
  cfg: SchemaSynthMetricWorkerConfig
): Promise<void> {
  const storageIds = resolveObservationStorageTypes({
    sessionOverride: cfg.observationStorageOverride,
    intentDestinations: cfg.storageTypes,
    createIntentStorage: cfg.createIntentStorage
  });
  const prometheusWriteMode = resolvePrometheusWriteMode(
    cfg.mode,
    storageIds.includes("prometheus"),
  );

  await persistObservationWithStorage({
    graphTool: graphDb,
    intentId: cfg.intentId,
    compoundMetric: cfg.compoundMetric,
    conditionId: cfg.conditionId,
    unit: cfg.unit,
    payload,
    turtle: ttl,
    storageTypes: cfg.storageTypes,
    sessionOverride: cfg.observationStorageOverride,
    createIntentStorage: cfg.createIntentStorage,
    prometheusWriteMode,
    log: { source: "schema-synth", frequencySeconds: cfg.frequencySeconds }
  });
}

type PrometheusFlushCtx = {
  intentId: string;
  metric: string;
};

async function maybeFlushPrometheusChunk(
  flushCtx: PrometheusFlushCtx,
  chunkSize: number,
  totalFlushed: { count: number },
): Promise<void> {
  if (chunkSize <= 0) {
    return;
  }
  while (bufferedPrometheusSampleCount() >= chunkSize) {
    const result = await flushBufferedPrometheusRemoteWriteChunk(
      { intentId: flushCtx.intentId, metric: flushCtx.metric, source: "schema-synth" },
      { chunkSize },
    );
    if (result.sampleCount > 0) {
      totalFlushed.count += result.sampleCount;
      process.stderr.write(
        `[schema-synth-historic] intent=${flushCtx.intentId} metric=${flushCtx.metric} ` +
          `remote_write_chunk=${result.sampleCount} total_flushed=${totalFlushed.count} ` +
          `buffered=${result.remainingBuffered}\n`,
      );
    }
    if (!result.ok) {
      throw new Error(result.error ?? "Prometheus remote write chunk flush failed");
    }
    if (result.sampleCount === 0) {
      break;
    }
  }
}

async function finalizePrometheusHistoricFlush(
  cfg: SchemaSynthMetricWorkerConfig,
  flushCtx: PrometheusFlushCtx,
  totalFlushed: { count: number },
  tickCount: number,
  startedMs: number,
): Promise<void> {
  const chunkSize = readPrometheusFlushChunkSize();
  if (chunkSize > 0) {
    const remainder = await flushBufferedPrometheusRemoteWriteChunk(
      { intentId: flushCtx.intentId, metric: flushCtx.metric, source: "schema-synth" },
      { force: true },
    );
    if (!remainder.ok) {
      throw new Error(
        remainder.error ??
          `Prometheus remote write flush failed for ${cfg.compoundMetric} (${remainder.sampleCount} samples)`,
      );
    }
    totalFlushed.count += remainder.sampleCount;
  } else {
    const flushResult = await flushBufferedPrometheusRemoteWrite({
      intentId: flushCtx.intentId,
      metric: flushCtx.metric,
      source: "schema-synth",
    });
    if (!flushResult.ok) {
      throw new Error(
        flushResult.error ??
          `Prometheus remote write flush failed for ${cfg.compoundMetric} (${flushResult.sampleCount} samples)`,
      );
    }
    totalFlushed.count += flushResult.sampleCount;
  }

  const elapsedSec = ((Date.now() - startedMs) / 1000).toFixed(1);
  process.stderr.write(
    `[schema-synth-historic] intent=${flushCtx.intentId} metric=${flushCtx.metric} ` +
      `ticks=${tickCount} samples_flushed=${totalFlushed.count} elapsed_s=${elapsedSec}\n`,
  );
}

const HARD_CHECK_IDS = new Set(["sample_count", "counter_monotonic"]);

function enforceValidation(
  cfg: SchemaSynthMetricWorkerConfig,
  doc: ConstraintDocument,
  samples: Array<{ tMs: number; value: number }>,
): void {
  if (cfg.validateBeforeFlush === false) return;
  const result = validateMetricSeries(doc, { metric: cfg.compoundMetric, samples });
  const hardFails = result.checks.filter((c) => HARD_CHECK_IDS.has(c.id.split(":").pop() ?? c.id) && !c.ok);
  const softFails = result.checks.filter((c) => !HARD_CHECK_IDS.has(c.id.split(":").pop() ?? c.id) && !c.ok);
  for (const c of softFails) {
    appendObservationError({
      kind: "synthetic_setup_failed",
      message: `schema-synth soft validation: ${c.id}: ${c.detail}`,
      intentId: cfg.intentId,
      sessionId: cfg.sessionId,
      metric: cfg.compoundMetric,
    });
    process.stderr.write(`[schema-synth-validate] soft ${c.id}: ${c.detail}\n`);
  }
  if (hardFails.length > 0) {
    const detail = hardFails.map((c: ValidationCheck) => `${c.id}: ${c.detail}`).join("; ");
    throw new Error(`schema-synth hard validation failed: ${detail}`);
  }
}

async function historicRun(
  cfg: SchemaSynthMetricWorkerConfig,
  doc: ConstraintDocument,
  sampler: MetricSampler,
  tool: ObservationTool,
  graphDb: GraphDbTool
): Promise<void> {
  const start = cfg.historicStartIso ? new Date(cfg.historicStartIso) : null;
  const end = cfg.historicEndIso ? new Date(cfg.historicEndIso) : null;
  if (!start || !end || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    throw new Error("historic mode requires historicStartIso and historicEndIso in worker config.");
  }
  const maxPoints = numericEnv("SYNTH_OBS_HISTORIC_MAX_POINTS", 250_000);
  const freqMs = Math.max(1, cfg.frequencySeconds) * 1000;

  const storageIds = resolveObservationStorageTypes({
    sessionOverride: cfg.observationStorageOverride,
    intentDestinations: cfg.storageTypes,
    createIntentStorage: cfg.createIntentStorage
  });
  const prometheusOnly = isPrometheusOnlyHistoric(cfg, storageIds);
  const chunkSize = readPrometheusFlushChunkSize();
  const flushCtx: PrometheusFlushCtx = {
    intentId: cfg.intentId,
    metric: cfg.compoundMetric,
  };
  const totalFlushed = { count: 0 };
  const startedMs = Date.now();
  const stopMs = end.getTime();
  const ticksTotal =
    cfg.ticksTotal ??
    Math.floor((stopMs - start.getTime()) / freqMs) + 1;

  reportWorkerTickProgress({
    intentId: cfg.intentId,
    compoundMetric: cfg.compoundMetric,
    ticksDone: 0,
    ticksTotal,
    phase: "generating",
    force: true,
  });

  const collected: Array<{ tMs: number; value: number }> = [];
  let t = start.getTime();
  while (t <= stopMs) {
    if (collected.length >= maxPoints) {
      throw new Error(`historic point cap (${maxPoints}) exceeded; widen window or lower frequency.`);
    }
    const value = sampler.sample(t);
    if (!Number.isFinite(value)) throw new Error("Sampler returned non-numeric observation.");
    emitStatusSampleEvent(cfg, t, value);
    collected.push({ tMs: t, value });
    t += freqMs;
    if (collected.length % 4096 === 0) {
      reportWorkerTickProgress({
        intentId: cfg.intentId,
        compoundMetric: cfg.compoundMetric,
        ticksDone: collected.length,
        ticksTotal,
        phase: "generating",
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  // Align validation expected count with inclusive Controller tick math.
  const docForValidate: ConstraintDocument = {
    ...doc,
    timeline: {
      ...doc.timeline,
      start: cfg.historicStartIso ?? doc.timeline.start,
      stop: new Date(stopMs + freqMs).toISOString(),
      frequencySeconds: cfg.frequencySeconds,
      mode: "historic",
    },
  };
  enforceValidation(cfg, docForValidate, collected);

  if (prometheusOnly) {
    initPrometheusSampleBuffer();
  }

  let tickIndex = 0;
  for (const point of collected) {
    const obtainedAt = isoNoMillis(new Date(point.tMs));
    if (prometheusOnly) {
      bufferPrometheusSample(
        prometheusSampleFromParts({
          compoundMetric: cfg.compoundMetric,
          intentId: cfg.intentId,
          conditionId: cfg.conditionId,
          unit: cfg.unit,
          value: point.value,
          obtainedAt,
        }),
      );
      await maybeFlushPrometheusChunk(flushCtx, chunkSize, totalFlushed);
    } else {
      const payload = tool.generateObservationForCompound(
        cfg.compoundMetric,
        cfg.unit,
        point.value,
        obtainedAt,
      );
      if (!payload) throw new Error("Invalid compoundMetric for Observation.");
      await insertOrPrint(graphDb, payload, tool.toTurtle(payload), cfg);
      if (storageIds.includes("prometheus")) {
        await maybeFlushPrometheusChunk(flushCtx, chunkSize, totalFlushed);
      }
    }

    tickIndex += 1;
    reportWorkerTickProgress({
      intentId: cfg.intentId,
      compoundMetric: cfg.compoundMetric,
      ticksDone: tickIndex,
      ticksTotal,
      phase: "generating",
      samplesFlushed: totalFlushed.count > 0 ? totalFlushed.count : undefined,
    });
    if (tickIndex % 4096 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (storageIds.includes("prometheus")) {
    reportWorkerTickProgress({
      intentId: cfg.intentId,
      compoundMetric: cfg.compoundMetric,
      ticksDone: tickIndex,
      ticksTotal,
      phase: "flushing",
      force: true,
    });
    await finalizePrometheusHistoricFlush(cfg, flushCtx, totalFlushed, tickIndex, startedMs);
  }

  markMetricCompleted(cfg.intentId, cfg.compoundMetric);
  reportWorkerTickProgress({
    intentId: cfg.intentId,
    compoundMetric: cfg.compoundMetric,
    ticksDone: tickIndex,
    ticksTotal,
    phase: "completed",
    samplesFlushed: totalFlushed.count > 0 ? totalFlushed.count : undefined,
    force: true,
  });
}

export function streamingSchedule(
  cfg: SchemaSynthMetricWorkerConfig,
  sampler: MetricSampler,
  tool: ObservationTool,
  graphDb: GraphDbTool
): void {
  const freqMs = Math.max(1, cfg.frequencySeconds) * 1000;

  void (async (): Promise<void> => {
    while (true) {
      const nowWall = Date.now();
      try {
        const value = sampler.sample(nowWall);
        if (!Number.isFinite(value)) throw new Error("Sampler returned non-numeric observation.");
        emitStatusSampleEvent(cfg, nowWall, value);
        const payload = tool.generateObservationForCompound(
          cfg.compoundMetric,
          cfg.unit,
          value,
          isoNoMillis(new Date(nowWall))
        );
        if (!payload) throw new Error("Invalid compoundMetric for Observation.");
        await insertOrPrint(graphDb, payload, tool.toTurtle(payload), cfg);
      } catch (e) {
        process.stderr.write(`schema_synth_metric_worker_tick_error:${String(e)}\n`);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, freqMs));
    }
  })();
}

export async function runSchemaSynthMetricWorkerFromConfig(
  cfg: SchemaSynthMetricWorkerConfig,
  doc: ConstraintDocument
): Promise<void> {
  const metricName = doc.metrics[0]?.name ?? cfg.compoundMetric;
  const epochStartMs = cfg.historicStartIso
    ? Date.parse(cfg.historicStartIso)
    : Date.now();
  const sampler = createMetricSampler(doc, metricName, {
    seedOverride: doc.seed ?? `${cfg.intentId}|${cfg.compoundMetric}`,
    epochStartMs: Number.isFinite(epochStartMs) ? epochStartMs : Date.now(),
  });
  const tool = new ObservationTool();
  const graphDb = GraphDbTool.fromEnv(cfg);
  const registered = new Set<string>();
  await registerObservationMetadataForMetric(
    graphDb,
    cfg.compoundMetric,
    cfg.conditionId,
    cfg.unit,
    cfg.intentId,
    cfg.storageTypes,
    cfg.observationStorageOverride,
    cfg.createIntentStorage,
    registered
  );

  if (cfg.mode === "historic") {
    await historicRun(cfg, doc, sampler, tool, graphDb);
    return;
  }
  streamingSchedule(cfg, sampler, tool, graphDb);
}

async function cliMain(): Promise<void> {
  const cfgPath = process.argv[2];
  if (!cfgPath) {
    process.stderr.write("Usage: npx tsx schemaSynthMetricWorker.ts <worker-config.json>\n");
    process.exit(2);
  }
  const cfg = loadCfg(cfgPath);
  const doc = loadConstraint(cfg.constraintPath);
  try {
    await runSchemaSynthMetricWorkerFromConfig(cfg, doc);
  } catch (error) {
    if (cfg.mode === "historic") {
      markMetricFailed(cfg.intentId, cfg.compoundMetric);
    }
    throw error;
  }

  if (cfg.mode === "streaming") {
    process.stdout.write(
      `[schema-synth-worker] streaming ${cfg.compoundMetric} every ${cfg.frequencySeconds}s pid=${process.pid}\n`
    );
  }
}

const argvProg = typeof process.argv[1] === "string" ? process.argv[1] : "";
if (basename(argvProg).includes("schemaSynthMetricWorker")) {
  cliMain().catch((e) => {
    process.stderr.write(`schema_synth_metric_worker_fatal:${String(e)}\n`);
    process.exit(1);
  });
}
