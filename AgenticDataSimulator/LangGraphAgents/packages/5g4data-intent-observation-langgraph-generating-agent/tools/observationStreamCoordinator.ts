import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GraphDbTool } from "./graphdbTool.js";
import type { GraphDbEnvFallback } from "./graphTargetBinding.js";
import { resolveObsLogMaxEntries } from "./observationLog.js";
import { ObservationTool, type ConditionMetric, type ReportableObservationStream } from "./observationTool.js";
import {
  flushBufferedPrometheusRemoteWriteChunk,
} from "./observationStorage/prometheusBackend.js";
import {
  persistObservationWithStorage,
  registerObservationMetadataForMetric
} from "./persistObservation.js";
import { resolveObservationStorageTypes } from "./resolveObservationStorage.js";
import type { ObservationStorageId } from "./observationStorageTypes.js";
import {
  resolvePrometheusWriteMode,
  usesRemoteWriteForStreaming,
} from "./sessionPrometheusEnv.js";

export interface StartObservationStreamsArgs {
  sessionId: string;
  intentId: string;
  intentTurtle: string;
  packageDir: string;
  graphCfg: GraphDbEnvFallback;
  debug: boolean;
  debugLogPath: string;
  /** Session override from `request observation-report … storage`. */
  observationStorageOverride?: ObservationStorageId | null;
  /** From Controller `create intent … storage` for this intent alias. */
  createIntentStorage?: ObservationStorageId | null;
}

interface StreamRuntime {
  stream: ReportableObservationStream;
  timer: NodeJS.Timeout;
}

interface SessionState {
  intentId: string;
  streams: StreamRuntime[];
  overrides: Map<string, { min?: number; max?: number }>;
}

const sessions = new Map<string, SessionState>();

function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

function metricName(stream: ReportableObservationStream): string {
  return stream.compoundMetric;
}

function randomInRange(min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

export function resolveStreamValueSpan(
  stream: ReportableObservationStream,
  override?: { min?: number; max?: number }
): { min: number; max: number } {
  return {
    min: override?.min ?? stream.minValue,
    max: override?.max ?? stream.maxValue
  };
}

function streamAsConditionMetric(stream: ReportableObservationStream): ConditionMetric {
  return {
    conditionId: stream.conditionId,
    targetProperty: stream.targetProperty,
    compoundMetric: stream.compoundMetric,
    unit: stream.unit
  };
}

async function emitTick(
  sessionId: string,
  state: SessionState,
  stream: ReportableObservationStream,
  tool: ObservationTool,
  graphTool: GraphDbTool,
  args: StartObservationStreamsArgs
): Promise<void> {
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const metric = metricName(stream);
  const override = state.overrides.get(metric);
  const { min, max } = resolveStreamValueSpan(stream, override);
  const value = randomInRange(min, max);
  const payload = tool.generateObservation(streamAsConditionMetric(stream), value, iso);
  const turtle = tool.toTurtle(payload);

  const storageIds = resolveObservationStorageTypes({
    sessionOverride: args.observationStorageOverride,
    intentDestinations: stream.storageTypes,
    createIntentStorage: args.createIntentStorage,
  });
  const prometheusWriteMode = resolvePrometheusWriteMode("streaming", storageIds.includes("prometheus"));

  await persistObservationWithStorage({
    graphTool,
    intentId: state.intentId,
    compoundMetric: metric,
    conditionId: stream.conditionId,
    unit: stream.unit,
    payload,
    turtle,
    storageTypes: stream.storageTypes,
    sessionOverride: args.observationStorageOverride,
    createIntentStorage: args.createIntentStorage,
    prometheusWriteMode,
    log: { source: "stream", sessionId, frequencySeconds: stream.frequencySeconds },
  });

  if (usesRemoteWriteForStreaming() && storageIds.includes("prometheus")) {
    await flushBufferedPrometheusRemoteWriteChunk(
      { intentId: state.intentId, metric },
      { force: true },
    );
  }

  if (!args.debug) return;

  const streamLogPath = resolve(process.cwd(), "logs", "observations-stream.ndjson");
  ensureParentDir(streamLogPath);
  appendFileSync(
    streamLogPath,
    `${JSON.stringify({
      timestampUtc: now.toISOString(),
      sessionId,
      intentId: state.intentId,
      metric,
      value,
      frequencySeconds: stream.frequencySeconds
    })}\n`,
    "utf8"
  );

  const metricLogPath = resolve(
    process.cwd(),
    "logs",
    "observations-by-metric",
    `${metric}.ttl`
  );
  ensureParentDir(metricLogPath);
  appendFileSync(metricLogPath, `# emittedAt=${now.toISOString()}\n${turtle}\n---\n`, "utf8");
}

export async function startObservationStreams(args: StartObservationStreamsArgs): Promise<string> {
  stopObservationStreams(args.sessionId);
  const tool = new ObservationTool();
  const streams = tool.parseReportableObservationStreams(args.intentTurtle);
  if (streams.length === 0) {
    return "No reportable observation streams found (check ObservationReportingExpectation + Conditions + report triggers).";
  }

  const graphTool = GraphDbTool.fromEnv(args.graphCfg);

  const state: SessionState = {
    intentId: args.intentId,
    streams: [],
    overrides: new Map()
  };
  sessions.set(args.sessionId, state);

  const storedMetrics = new Set<string>();
  for (const stream of streams) {
    const metric = metricName(stream);
    if (storedMetrics.has(metric)) continue;
    await registerObservationMetadataForMetric(
      graphTool,
      metric,
      stream.conditionId,
      stream.unit,
      args.intentId,
      stream.storageTypes,
      args.observationStorageOverride,
      args.createIntentStorage,
      storedMetrics
    );
  }

  for (const stream of streams) {
    const tick = () => {
      void emitTick(args.sessionId, state, stream, tool, graphTool, args);
    };
    tick();
    const timer = setInterval(tick, Math.max(1, stream.frequencySeconds) * 1000);
    state.streams.push({ stream, timer });
  }

  const logsRoot = resolve(process.cwd(), "logs");
  return [
    `Started ${state.streams.length} observation stream(s) for intent ${args.intentId}.`,
    `Observation logs (last ${resolveObsLogMaxEntries()} per metric): ${logsRoot}/observations-<metric>.ndjson`,
    `Tick log (debug): ${resolve(logsRoot, "observations-stream.ndjson")}`,
    `Per-metric Turtle (debug): ${resolve(logsRoot, "observations-by-metric")}/`,
    "Commands: `observe status`, `observe stop`, `observe override metric=... min=... max=...`."
  ].join("\n");
}

export function stopObservationStreams(sessionId: string): string {
  const state = sessions.get(sessionId);
  if (!state) return "No active observation streams for this session.";
  for (const rt of state.streams) clearInterval(rt.timer);
  sessions.delete(sessionId);
  return `Stopped ${state.streams.length} observation stream(s).`;
}

export function stopAllObservationStreams(): void {
  for (const sessionId of sessions.keys()) {
    stopObservationStreams(sessionId);
  }
}

export function observationStreamStatus(sessionId: string): string {
  const state = sessions.get(sessionId);
  if (!state || state.streams.length === 0) return "No active observation streams.";
  const lines = state.streams.map(
    ({ stream }) =>
      `- metric=${metricName(stream)}, storage=${stream.storageTypes.join("+")}, every=${stream.frequencySeconds}s, min=${stream.minValue}, max=${stream.maxValue}`
  );
  return [`Active observation streams: ${state.streams.length}`, ...lines].join("\n");
}

export function applyObservationOverride(
  sessionId: string,
  metric: string,
  min?: number,
  max?: number
): string {
  const state = sessions.get(sessionId);
  if (!state) return "No active observation streams. Start with `observe start intent_id=...`.";
  const prev = state.overrides.get(metric) ?? {};
  state.overrides.set(metric, { min: min ?? prev.min, max: max ?? prev.max });
  const merged = state.overrides.get(metric) ?? {};
  return `Override stored for ${metric}: min=${merged.min ?? "unchanged"}, max=${merged.max ?? "unchanged"}.`;
}
