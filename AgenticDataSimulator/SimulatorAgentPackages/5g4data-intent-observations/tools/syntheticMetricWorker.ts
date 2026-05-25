/**
 * Per-metric child process: loads LLM-produced snippet (`new Function('ctx', snippet)`),
 * streams or emits historic timestamps, publishes Turtle observations.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { GraphDbTool } from "./graphdbTool.js";
import { ObservationTool, type ObservationPayload } from "./observationTool.js";
import { persistObservationWithStorage, registerObservationMetadataForMetric } from "./persistObservation.js";
import { flushBufferedPrometheusRemoteWrite } from "./observationStorageRegistry.js";
import type { ObservationStorageId } from "./observationStorageTypes.js";
import { resolveObservationStorageTypes } from "./resolveObservationStorage.js";
import {
  hashSeed,
  localHourFromSim,
  mulberry32,
  parseUtcOffsetMinutes
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
  /** Offset minutes east of UTC from optional `timezone` global (e.g. `UTC+2`). */
  utcOffsetMinutes: number;
  /** Hour-of-day (0–23) after applying `utcOffsetMinutes` to `simTime`. */
  localHour: number;
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
    unitHint: cfg.unit,
    utcOffsetMinutes,
    localHour: localHourFromSim(simTime, utcOffsetMinutes)
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
  const prometheusWriteMode =
    cfg.mode === "historic" && storageIds.includes("prometheus") ? "buffer" : "push";

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

  let t = start.getTime();
  const stop = end.getTime();
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
    const payload = tool.generateObservationForCompound(cfg.compoundMetric, cfg.unit, value, isoNoMillis(ctx.simTime));
    if (!payload) throw new Error("Invalid compoundMetric for Observation.");
    await insertOrPrint(graphDb, payload, tool.toTurtle(payload), cfg);

    tickIndex += 1;
    t += freqMs;
    if (tickIndex % 4096 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const storageIds = resolveObservationStorageTypes({
    sessionOverride: cfg.observationStorageOverride,
    intentDestinations: cfg.storageTypes,
    createIntentStorage: cfg.createIntentStorage
  });
  if (storageIds.includes("prometheus")) {
    await flushBufferedPrometheusRemoteWrite();
  }
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
  await runSyntheticMetricWorkerFromConfig(cfg, snippetBody);

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
