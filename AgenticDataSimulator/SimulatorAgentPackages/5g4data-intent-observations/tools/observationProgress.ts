import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { observationLogsDirectory } from "./observationLog.js";

export type ObservationProgressPhase =
  | "codegen"
  | "generating"
  | "flushing"
  | "completed"
  | "failed";

export type MetricProgressPhase =
  | "pending"
  | "codegen"
  | "generating"
  | "flushing"
  | "completed"
  | "failed";

export interface MetricProgressEntry {
  compoundMetric: string;
  phase: MetricProgressPhase;
  ticksDone: number;
  ticksTotal: number | null;
  samplesFlushed?: number;
  workerPid?: number;
}

export interface ObservationProgressAggregate {
  ticksDone: number;
  ticksTotal: number | null;
  percent: number | null;
}

export interface ObservationProgressSnapshot {
  schemaVersion: "observation_progress_v1";
  updatedAt: string;
  intentId: string;
  sessionId?: string;
  mode: "streaming" | "historic";
  phase: ObservationProgressPhase;
  codegenMetricsDone: number;
  codegenMetricsTotal: number;
  metrics: MetricProgressEntry[];
  aggregate: ObservationProgressAggregate;
}

const PROGRESS_SCHEMA = "observation_progress_v1" as const;

function sanitizeIntentIdForFilename(intentId: string): string {
  const trimmed = intentId.trim();
  const safe = trimmed.replace(/[^\w.-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return (safe || "unknown-intent").slice(0, 160);
}

export function observationProgressDirectory(): string {
  return resolve(observationLogsDirectory(), "observation-progress");
}

export function observationProgressPathForIntent(intentId: string): string {
  return resolve(observationProgressDirectory(), `${sanitizeIntentIdForFilename(intentId)}.json`);
}

export function historicTickCount(
  start: Date,
  end: Date,
  frequencySeconds: number,
): number {
  const freqMs = Math.max(1, frequencySeconds) * 1000;
  const count = Math.floor((end.getTime() - start.getTime()) / freqMs) + 1;
  return Number.isFinite(count) && count >= 1 ? count : 0;
}

export function computeAggregate(metrics: MetricProgressEntry[]): ObservationProgressAggregate {
  let ticksDone = 0;
  let ticksTotal = 0;
  let hasBoundedTotal = false;

  for (const entry of metrics) {
    ticksDone += Math.max(0, entry.ticksDone);
    if (entry.ticksTotal !== null && entry.ticksTotal > 0) {
      hasBoundedTotal = true;
      ticksTotal += entry.ticksTotal;
    }
  }

  if (!hasBoundedTotal) {
    return { ticksDone, ticksTotal: null, percent: null };
  }

  const percent =
    ticksTotal > 0 ? Math.min(100, Math.round((ticksDone / ticksTotal) * 1000) / 10) : null;

  return { ticksDone, ticksTotal, percent };
}

function deriveOverallPhase(metrics: MetricProgressEntry[]): ObservationProgressPhase {
  if (metrics.some((m) => m.phase === "failed")) {
    return "failed";
  }
  if (metrics.length > 0 && metrics.every((m) => m.phase === "completed")) {
    return "completed";
  }
  if (metrics.some((m) => m.phase === "flushing")) {
    return "flushing";
  }
  if (metrics.some((m) => m.phase === "generating")) {
    return "generating";
  }
  if (metrics.some((m) => m.phase === "codegen")) {
    return "codegen";
  }
  return "generating";
}

function writeSnapshotAtomic(path: string, snapshot: ObservationProgressSnapshot): void {
  ensureProgressDir();
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot)}\n`, "utf8");
  renameSync(tmp, path);
}

function ensureProgressDir(): void {
  const dir = observationProgressDirectory();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readObservationProgress(intentId: string): ObservationProgressSnapshot | null {
  const path = observationProgressPathForIntent(intentId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ObservationProgressSnapshot;
    if (parsed.schemaVersion !== PROGRESS_SCHEMA) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeObservationProgress(snapshot: ObservationProgressSnapshot): void {
  const path = observationProgressPathForIntent(snapshot.intentId);
  writeSnapshotAtomic(path, snapshot);
}

function orderMetricEntries(
  preferredOrder: string[],
  entries: MetricProgressEntry[],
): MetricProgressEntry[] {
  const byName = new Map(entries.map((entry) => [entry.compoundMetric, entry]));
  const ordered: MetricProgressEntry[] = [];
  for (const compoundMetric of preferredOrder) {
    const entry = byName.get(compoundMetric);
    if (entry) {
      ordered.push(entry);
      byName.delete(compoundMetric);
    }
  }
  for (const entry of byName.values()) {
    ordered.push(entry);
  }
  return ordered;
}

export function initObservationProgress(input: {
  intentId: string;
  sessionId?: string;
  mode: "streaming" | "historic";
  compoundMetrics: string[];
  ticksTotalPerMetric: Map<string, number | null>;
}): ObservationProgressSnapshot {
  const existing = readObservationProgress(input.intentId);
  if (existing && existing.mode === input.mode) {
    const mergedByName = new Map(
      existing.metrics.map((entry) => [entry.compoundMetric, entry]),
    );

    for (const compoundMetric of input.compoundMetrics) {
      const ticksTotal = input.ticksTotalPerMetric.get(compoundMetric) ?? null;
      const prior = mergedByName.get(compoundMetric);
      if (!prior) {
        mergedByName.set(compoundMetric, {
          compoundMetric,
          phase: "pending",
          ticksDone: 0,
          ticksTotal,
        });
        continue;
      }
      if (prior.ticksTotal === null && ticksTotal !== null) {
        mergedByName.set(compoundMetric, { ...prior, ticksTotal });
      }
    }

    const metrics = orderMetricEntries(
      [...new Set([...existing.metrics.map((m) => m.compoundMetric), ...input.compoundMetrics])],
      [...mergedByName.values()],
    );

    const snapshot: ObservationProgressSnapshot = {
      ...existing,
      sessionId: input.sessionId ?? existing.sessionId,
      metrics,
      codegenMetricsTotal: Math.max(
        existing.codegenMetricsTotal,
        metrics.length,
      ),
      aggregate: computeAggregate(metrics),
      phase: deriveOverallPhase(metrics),
    };

    writeObservationProgress(snapshot);
    return snapshot;
  }

  const metrics: MetricProgressEntry[] = input.compoundMetrics.map((compoundMetric) => ({
    compoundMetric,
    phase: "pending",
    ticksDone: 0,
    ticksTotal: input.ticksTotalPerMetric.get(compoundMetric) ?? null,
  }));

  const snapshot: ObservationProgressSnapshot = {
    schemaVersion: PROGRESS_SCHEMA,
    updatedAt: new Date().toISOString(),
    intentId: input.intentId,
    sessionId: input.sessionId,
    mode: input.mode,
    phase: "codegen",
    codegenMetricsDone: 0,
    codegenMetricsTotal: input.compoundMetrics.length,
    metrics,
    aggregate: computeAggregate(metrics),
  };

  writeObservationProgress(snapshot);
  return snapshot;
}

export function patchObservationProgress(
  intentId: string,
  patch: (current: ObservationProgressSnapshot | null) => ObservationProgressSnapshot | null,
): ObservationProgressSnapshot | null {
  const next = patch(readObservationProgress(intentId));
  if (!next) {
    return null;
  }
  next.updatedAt = new Date().toISOString();
  next.aggregate = computeAggregate(next.metrics);
  next.phase = deriveOverallPhase(next.metrics);
  writeObservationProgress(next);
  return next;
}

export function updateMetricProgress(
  intentId: string,
  compoundMetric: string,
  update: Partial<
    Pick<MetricProgressEntry, "phase" | "ticksDone" | "ticksTotal" | "samplesFlushed" | "workerPid">
  >,
): void {
  patchObservationProgress(intentId, (current) => {
    if (!current) {
      return null;
    }
    const metrics = current.metrics.map((entry) => {
      if (entry.compoundMetric !== compoundMetric) {
        return entry;
      }
      return { ...entry, ...update };
    });
    return { ...current, metrics };
  });
}

export function markCodegenMetric(
  intentId: string,
  compoundMetric: string,
  codegenMetricsDone: number,
): void {
  patchObservationProgress(intentId, (current) => {
    if (!current) return null;
    const metrics = current.metrics.map((entry) =>
      entry.compoundMetric === compoundMetric
        ? { ...entry, phase: "codegen" as const }
        : entry,
    );
    return {
      ...current,
      phase: "codegen",
      codegenMetricsDone,
      metrics,
    };
  });
}

export function markCodegenComplete(
  intentId: string,
  compoundMetric: string,
  workerPid: number | undefined,
): void {
  patchObservationProgress(intentId, (current) => {
    if (!current) return null;
    const codegenMetricsDone = Math.min(
      current.codegenMetricsTotal,
      current.codegenMetricsDone + 1,
    );
    const metrics = current.metrics.map((entry) =>
      entry.compoundMetric === compoundMetric
        ? {
            ...entry,
            phase: "generating" as const,
            workerPid,
          }
        : entry,
    );
    return {
      ...current,
      codegenMetricsDone,
      metrics,
    };
  });
}

export function markMetricFailed(intentId: string, compoundMetric: string): void {
  updateMetricProgress(intentId, compoundMetric, { phase: "failed" });
}

export function markMetricCompleted(intentId: string, compoundMetric: string): void {
  patchObservationProgress(intentId, (current) => {
    if (!current) return null;
    const metrics = current.metrics.map((entry) => {
      if (entry.compoundMetric !== compoundMetric) {
        return entry;
      }
      const ticksTotal = entry.ticksTotal;
      const ticksDone =
        ticksTotal !== null && ticksTotal > 0 ? ticksTotal : entry.ticksDone;
      return {
        ...entry,
        phase: "completed" as const,
        ticksDone,
      };
    });
    return { ...current, metrics };
  });
}

const lastWorkerWriteMs = new Map<string, number>();

export function resolveProgressTickInterval(): number {
  const raw = process.env.OBS_PROGRESS_TICK_INTERVAL?.trim();
  if (!raw) return 1000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1000;
  return Math.floor(n);
}

/** Throttled progress update from detached metric workers. */
export function reportWorkerTickProgress(input: {
  intentId: string;
  compoundMetric: string;
  ticksDone: number;
  ticksTotal: number | null;
  phase?: MetricProgressPhase;
  samplesFlushed?: number;
  force?: boolean;
}): void {
  const key = `${input.intentId}|${input.compoundMetric}`;
  const now = Date.now();
  const interval = resolveProgressTickInterval();
  if (!input.force && now - (lastWorkerWriteMs.get(key) ?? 0) < interval) {
    return;
  }
  lastWorkerWriteMs.set(key, now);

  updateMetricProgress(input.intentId, input.compoundMetric, {
    phase: input.phase ?? "generating",
    ticksDone: input.ticksDone,
    ticksTotal: input.ticksTotal,
    ...(input.samplesFlushed !== undefined ? { samplesFlushed: input.samplesFlushed } : {}),
  });
}

export function getObservationProgressResponse(intentId: string): {
  status: "idle" | "active";
  progress: ObservationProgressSnapshot | null;
} {
  const trimmed = intentId.trim();
  if (!trimmed) {
    return { status: "idle", progress: null };
  }
  const progress = readObservationProgress(trimmed);
  if (!progress) {
    return { status: "idle", progress: null };
  }
  return { status: "active", progress };
}
