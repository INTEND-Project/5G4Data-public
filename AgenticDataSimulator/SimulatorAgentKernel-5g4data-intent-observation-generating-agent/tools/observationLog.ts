import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ObservationPayload } from "./observationTool.js";

export const DEFAULT_OBS_LOG_N = 100;

export type ObservationLogSource = "stream" | "synthetic";

export interface ObservationLogEntry {
  schemaVersion: "observation_v1";
  timestampUtc: string;
  source: ObservationLogSource;
  sessionId?: string;
  intentId?: string;
  metric: string;
  observationId: string;
  value: number;
  unit: string;
  obtainedAt: string;
  turtle: string;
  graphDbWritten: boolean;
  frequencySeconds?: number;
}

function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

/** Safe filename segment from a compound metric name (`targetProperty_conditionId`). */
export function sanitizeMetricForLogFilename(metric: string): string {
  const trimmed = metric.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
  const safe = trimmed.replace(/[^\w.-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return (safe || "unknown-metric").slice(0, 160);
}

export function observationLogsDirectory(): string {
  const override = process.env.OBSERVATION_LOG_PATH?.trim();
  if (override) return resolve(override);
  return resolve(process.cwd(), "logs");
}

/** Per-metric NDJSON log: `logs/observations-<metric>.ndjson` (or under `OBSERVATION_LOG_PATH`). */
export function observationLogPathForMetric(metric: string): string {
  const name = sanitizeMetricForLogFilename(metric);
  return resolve(observationLogsDirectory(), `observations-${name}.ndjson`);
}

/** Per-metric JS program log: `logs/observation-program-<metric>.js` (synthetic codegen body). */
export function observationProgramPathForMetric(metric: string): string {
  const name = sanitizeMetricForLogFilename(metric);
  return resolve(observationLogsDirectory(), `observation-program-${name}.js`);
}

/** Persist the latest LLM-generated observation sampler (function body for `new Function('ctx', body)`). */
export function writeObservationProgramLog(args: {
  metric: string;
  program: string;
  intentId?: string;
  sessionId?: string;
  mode?: string;
  frequencySeconds?: number;
}): string {
  const path = observationProgramPathForMetric(args.metric);
  ensureParentDir(path);
  const header = [
    "// Observation sampler program (JavaScript function body)",
    "// Executed as: new Function('ctx', <body>)",
    `// metric: ${args.metric}`,
    args.intentId ? `// intentId: ${args.intentId}` : null,
    args.sessionId ? `// sessionId: ${args.sessionId}` : null,
    args.mode ? `// mode: ${args.mode}` : null,
    args.frequencySeconds !== undefined ? `// frequencySeconds: ${args.frequencySeconds}` : null,
    `// writtenAt: ${new Date().toISOString()}`,
    ""
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  writeFileSync(path, `${header}${args.program.trim()}\n`, "utf8");
  return path;
}

/** Max NDJSON lines retained in the observation log (`OBS_LOG_N`; default 100). */
export function resolveObsLogMaxEntries(): number {
  const raw = process.env.OBS_LOG_N?.trim();
  if (!raw) return DEFAULT_OBS_LOG_N;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_OBS_LOG_N;
  return Math.floor(n);
}

function readLogLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, "utf8");
  if (!text.trim()) return [];
  return text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
}

function writeCappedLogLines(filePath: string, lines: string[]): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}

export function appendGeneratedObservation(
  entry: Omit<ObservationLogEntry, "schemaVersion" | "timestampUtc"> & {
    timestampUtc?: string;
  },
  logPath?: string,
  maxEntries?: number
): string {
  const path = logPath ?? observationLogPathForMetric(entry.metric);
  const maxN = maxEntries ?? resolveObsLogMaxEntries();
  if (maxN === 0) return path;

  const line: ObservationLogEntry = {
    schemaVersion: "observation_v1",
    timestampUtc: entry.timestampUtc ?? new Date().toISOString(),
    source: entry.source,
    sessionId: entry.sessionId,
    intentId: entry.intentId,
    metric: entry.metric,
    observationId: entry.observationId,
    value: entry.value,
    unit: entry.unit,
    obtainedAt: entry.obtainedAt,
    turtle: entry.turtle,
    graphDbWritten: entry.graphDbWritten,
    frequencySeconds: entry.frequencySeconds
  };
  const serialized = JSON.stringify(line);
  const existing = readLogLines(path);
  existing.push(serialized);
  const capped = maxN > 0 ? existing.slice(-maxN) : existing;
  writeCappedLogLines(path, capped);
  return path;
}

export function logObservationPayload(args: {
  source: ObservationLogSource;
  payload: ObservationPayload;
  turtle: string;
  graphDbWritten: boolean;
  sessionId?: string;
  intentId?: string;
  frequencySeconds?: number;
  logPath?: string;
}): string {
  return appendGeneratedObservation(
    {
      source: args.source,
      sessionId: args.sessionId,
      intentId: args.intentId,
      metric: args.payload.observedMetric,
      observationId: args.payload.observationId,
      value: args.payload.value,
      unit: args.payload.unit,
      obtainedAt: args.payload.obtainedAt,
      turtle: args.turtle,
      graphDbWritten: args.graphDbWritten,
      frequencySeconds: args.frequencySeconds
    },
    args.logPath
  );
}
