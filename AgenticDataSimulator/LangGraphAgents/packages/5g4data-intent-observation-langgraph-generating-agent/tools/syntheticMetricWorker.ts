/**
 * Per-metric child process: loads LLM-produced snippet (`new Function('ctx', snippet)`),
 * streams or emits historic timestamps, publishes Turtle observations.
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
  hashSeed,
  localHourFromSim,
  mulberry32,
  parseUtcOffsetMinutes,
  tickInDayFromTickIndex,
  tickInHourFromSim
} from "./syntheticPrng.js";

export interface SyntheticMetricWorkerConfig {
  compoundMetric: string;
  unit: string;
  intentId: string;
  mode: "streaming" | "historic";
  frequencySeconds: number;
  snippetPath: string;
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
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw !== undefined ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface SnippetCtx {
  simTime: Date;
  tickIndex: number;
  mode: "streaming" | "historic";
  metric: string;
  intentId: string;
  frequencySeconds: number;
  unitHint: string;
  uniform01: () => number;
  /** Deterministic uniform (0,1] for accumulation loop step `stepIndex` (stable across tickIndex). */
  uniformForStep: (stepIndex: number) => number;
  /** Offset minutes east of UTC from optional `timezone` global (e.g. `UTC+2`). */
  utcOffsetMinutes: number;
  /** Hour-of-day (0–23) after applying `utcOffsetMinutes` to `simTime`. */
  localHour: number;
  /** Day index since historic start: floor(tickIndex * frequencySeconds / 86400). */
  tickInDay: number;
  /** Tick slot within the current local hour (use for stress-window dip scheduling). */
  tickInHour: number;
}

export function uniformForStepRng(
  intentId: string,
  compoundMetric: string,
  mode: "streaming" | "historic",
  stepIndex: number
): number {
  return mulberry32(hashSeed(`${intentId}|${compoundMetric}|${mode}|step|${stepIndex}`))();
}

function buildSnippetCtx(
  cfg: SyntheticMetricWorkerConfig,
  simTime: Date,
  tickIndex: number,
  uniform01: () => number
): SnippetCtx {
  const utcOffsetMinutes = parseUtcOffsetMinutes(cfg.timezoneHint);
  return {
    simTime,
    tickIndex,
    mode: cfg.mode,
    metric: cfg.compoundMetric,
    intentId: cfg.intentId,
    frequencySeconds: cfg.frequencySeconds,
    uniform01,
    uniformForStep: (stepIndex: number) =>
      uniformForStepRng(cfg.intentId, cfg.compoundMetric, cfg.mode, stepIndex),
    unitHint: cfg.unit,
    utcOffsetMinutes,
    localHour: localHourFromSim(simTime, utcOffsetMinutes),
    tickInDay: tickInDayFromTickIndex(tickIndex, cfg.frequencySeconds),
    tickInHour: tickInHourFromSim(simTime, cfg.frequencySeconds, utcOffsetMinutes)
  };
}

export function compileSnippet(snippetBody: string): (ctx: SnippetCtx) => number {
  return new Function("ctx", snippetBody) as (ctx: SnippetCtx) => number;
}

function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function loadCfg(path: string): SyntheticMetricWorkerConfig {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as SyntheticMetricWorkerConfig;
}

function isPrometheusOnlyHistoric(
  cfg: SyntheticMetricWorkerConfig,
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
  cfg: SyntheticMetricWorkerConfig
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
    log: { source: "synthetic", frequencySeconds: cfg.frequencySeconds }
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
      { intentId: flushCtx.intentId, metric: flushCtx.metric, source: "synthetic" },
      { chunkSize },
    );
    if (result.sampleCount > 0) {
      totalFlushed.count += result.sampleCount;
      process.stderr.write(
        `[synthetic-historic] intent=${flushCtx.intentId} metric=${flushCtx.metric} ` +
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
  cfg: SyntheticMetricWorkerConfig,
  flushCtx: PrometheusFlushCtx,
  totalFlushed: { count: number },
  tickCount: number,
  startedMs: number,
): Promise<void> {
  const chunkSize = readPrometheusFlushChunkSize();
  if (chunkSize > 0) {
    const remainder = await flushBufferedPrometheusRemoteWriteChunk(
      { intentId: flushCtx.intentId, metric: flushCtx.metric, source: "synthetic" },
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
      source: "synthetic",
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
    `[synthetic-historic] intent=${flushCtx.intentId} metric=${flushCtx.metric} ` +
      `ticks=${tickCount} samples_flushed=${totalFlushed.count} elapsed_s=${elapsedSec}\n`,
  );
}

async function historicRun(
  cfg: SyntheticMetricWorkerConfig,
  run: (ctx: SnippetCtx) => number,
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
    (() => {
      const freqMs = Math.max(1, cfg.frequencySeconds) * 1000;
      return Math.floor((stopMs - start.getTime()) / freqMs) + 1;
    })();

  reportWorkerTickProgress({
    intentId: cfg.intentId,
    compoundMetric: cfg.compoundMetric,
    ticksDone: 0,
    ticksTotal,
    phase: "generating",
    force: true,
  });

  if (prometheusOnly) {
    initPrometheusSampleBuffer();
  }

  let t = start.getTime();
  const stop = stopMs;
  let tickIndex = 0;
  while (t <= stop) {
    if (tickIndex >= maxPoints) {
      throw new Error(`historic point cap (${maxPoints}) exceeded; widen window or lower frequency.`);
    }
    const simTime = new Date(t);
    const rnd = mulberry32(hashSeed(`${cfg.intentId}|${cfg.compoundMetric}|historic|${tickIndex}`));
    const ctx = buildSnippetCtx(cfg, simTime, tickIndex, rnd);
    let value = Number(run(ctx));
    if (!Number.isFinite(value)) throw new Error("Snippet returned non-numeric observation.");
    const obtainedAt = isoNoMillis(ctx.simTime);

    if (prometheusOnly) {
      bufferPrometheusSample(
        prometheusSampleFromParts({
          compoundMetric: cfg.compoundMetric,
          intentId: cfg.intentId,
          conditionId: cfg.conditionId,
          unit: cfg.unit,
          value,
          obtainedAt,
        }),
      );
      await maybeFlushPrometheusChunk(flushCtx, chunkSize, totalFlushed);
    } else {
      const payload = tool.generateObservationForCompound(
        cfg.compoundMetric,
        cfg.unit,
        value,
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
    t += freqMs;
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
  cfg: SyntheticMetricWorkerConfig,
  run: (ctx: SnippetCtx) => number,
  tool: ObservationTool,
  graphDb: GraphDbTool
): void {
  const freqMs = Math.max(1, cfg.frequencySeconds) * 1000;

  void (async (): Promise<void> => {
    let tickIndex = 0;
    while (true) {
      const nowWall = Date.now();
      const rnd = mulberry32(hashSeed(`${cfg.intentId}|${cfg.compoundMetric}|stream|${tickIndex}|${nowWall}`));
      try {
        const ctx = buildSnippetCtx(cfg, new Date(nowWall), tickIndex, rnd);
        let value = Number(run(ctx));
        if (!Number.isFinite(value)) throw new Error("Snippet returned non-numeric observation.");
        const payload = tool.generateObservationForCompound(
          cfg.compoundMetric,
          cfg.unit,
          value,
          isoNoMillis(new Date(nowWall))
        );
        if (!payload) throw new Error("Invalid compoundMetric for Observation.");
        await insertOrPrint(graphDb, payload, tool.toTurtle(payload), cfg);
      } catch (e) {
        process.stderr.write(`synthetic_metric_worker_tick_error:${String(e)}\n`);
      }

      tickIndex += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, freqMs));
    }
  })();
}

export async function runSyntheticMetricWorkerFromConfig(cfg: SyntheticMetricWorkerConfig, snippetBody: string): Promise<void> {
  const run = compileSnippet(snippetBody);
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
    await historicRun(cfg, run, tool, graphDb);
    return;
  }
  streamingSchedule(cfg, run, tool, graphDb);
}

async function cliMain(): Promise<void> {
  const cfgPath = process.argv[2];
  if (!cfgPath) {
    process.stderr.write("Usage: npx tsx syntheticMetricWorker.ts <worker-config.json>\n");
    process.exit(2);
  }
  const cfg = loadCfg(cfgPath);
  const snippetBody = readFileSync(cfg.snippetPath, "utf8");
  try {
    await runSyntheticMetricWorkerFromConfig(cfg, snippetBody);
  } catch (error) {
    if (cfg.mode === "historic") {
      markMetricFailed(cfg.intentId, cfg.compoundMetric);
    }
    throw error;
  }

  if (cfg.mode === "streaming") {
    process.stdout.write(
      `[synthetic-worker] streaming ${cfg.compoundMetric} every ${cfg.frequencySeconds}s pid=${process.pid}\n`
    );
  }
}

const argvProg = typeof process.argv[1] === "string" ? process.argv[1] : "";
if (basename(argvProg).includes("syntheticMetricWorker")) {
  cliMain().catch((e) => {
    process.stderr.write(`synthetic_metric_worker_fatal:${String(e)}\n`);
    process.exit(1);
  });
}
