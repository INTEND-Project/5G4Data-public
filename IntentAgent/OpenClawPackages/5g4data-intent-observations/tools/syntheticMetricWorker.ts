/**
 * Per-metric child process: loads LLM-produced snippet (`new Function('ctx', snippet)`),
 * streams or emits historic timestamps, publishes Turtle observations.
 */

import { readFileSync } from "node:fs";
import { GraphDbTool } from "./graphdbTool.js";
import { ObservationTool } from "./observationTool.js";

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
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw !== undefined ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SnippetCtx {
  simTime: Date;
  tickIndex: number;
  mode: "streaming" | "historic";
  metric: string;
  intentId: string;
  frequencySeconds: number;
  unitHint: string;
  uniform01: () => number;
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

async function insertOrPrint(_tool: ObservationTool, graphDb: GraphDbTool | undefined, ttl: string) {
  if (process.env.NO_GRAPHDB === "true") {
    process.stdout.write(`${ttl}\n\nGraphDB write skipped (--noGraphDB)\n`);
    return;
  }
  if (!graphDb) return;
  await graphDb.insertTurtle(ttl);
}

async function historicRun(
  cfg: SyntheticMetricWorkerConfig,
  run: (ctx: SnippetCtx) => number,
  tool: ObservationTool,
  graphDb: GraphDbTool | undefined
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
    const rnd = mulberry32(hashSeed(`${cfg.intentId}|${cfg.compoundMetric}|historic|${tickIndex}`));
    const ctx: SnippetCtx = {
      simTime: new Date(t),
      tickIndex,
      mode: cfg.mode,
      metric: cfg.compoundMetric,
      intentId: cfg.intentId,
      frequencySeconds: cfg.frequencySeconds,
      uniform01: rnd,
      unitHint: cfg.unit
    };
    let value = Number(run(ctx));
    if (!Number.isFinite(value)) throw new Error("Snippet returned non-numeric observation.");
    const payload = tool.generateObservationForCompound(cfg.compoundMetric, cfg.unit, value, isoNoMillis(ctx.simTime));
    if (!payload) throw new Error("Invalid compoundMetric for Observation.");
    await insertOrPrint(tool, graphDb, tool.toTurtle(payload));

    tickIndex += 1;
    t += freqMs;
    if (tickIndex % 4096 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function streamingSchedule(
  cfg: SyntheticMetricWorkerConfig,
  run: (ctx: SnippetCtx) => number,
  tool: ObservationTool,
  graphDb: GraphDbTool | undefined
): void {
  const freqMs = Math.max(1, cfg.frequencySeconds) * 1000;

  void (async (): Promise<void> => {
    let tickIndex = 0;
    while (true) {
      const nowWall = Date.now();
      const rnd = mulberry32(hashSeed(`${cfg.intentId}|${cfg.compoundMetric}|stream|${tickIndex}|${nowWall}`));
      try {
        const ctx: SnippetCtx = {
          simTime: new Date(nowWall),
          tickIndex,
          mode: cfg.mode,
          metric: cfg.compoundMetric,
          intentId: cfg.intentId,
          frequencySeconds: cfg.frequencySeconds,
          uniform01: rnd,
          unitHint: cfg.unit
        };
        let value = Number(run(ctx));
        if (!Number.isFinite(value)) throw new Error("Snippet returned non-numeric observation.");
        const payload = tool.generateObservationForCompound(
          cfg.compoundMetric,
          cfg.unit,
          value,
          isoNoMillis(new Date(nowWall))
        );
        if (!payload) throw new Error("Invalid compoundMetric for Observation.");
        await insertOrPrint(tool, graphDb, tool.toTurtle(payload));
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
  const graphDb =
    process.env.NO_GRAPHDB === "true"
      ? undefined
      : GraphDbTool.fromEnv(cfg);

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
