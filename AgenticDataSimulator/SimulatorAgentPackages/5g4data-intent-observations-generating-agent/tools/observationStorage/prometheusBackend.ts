import {
  appendObservationError,
  type ObservationLogSource,
} from "../observationLog.js";
import { ObservationTool } from "../observationTool.js";
import {
  prometheusQueryLabels,
  toPrometheusMetricName
} from "../prometheusMetricNaming.js";
import { PrometheusTool, type PrometheusSample } from "../prometheusTool.js";
import type { ObservationPersistContext } from "./persistContext.js";
import { packageTraceToolCall } from "../packageMlflowTrace.js";

export type PrometheusRemoteWriteFlushContext = {
  intentId?: string;
  metric?: string;
  sessionId?: string;
  source?: ObservationLogSource;
};

export type PrometheusRemoteWriteFlushResult = {
  ok: boolean;
  sampleCount: number;
  error?: string;
};

export type PrometheusRemoteWriteChunkFlushResult = PrometheusRemoteWriteFlushResult & {
  /** Samples still buffered after this flush (when not forced). */
  remainingBuffered: number;
};

export const DEFAULT_SYNTH_OBS_PROM_FLUSH_CHUNK = 10_000;

function prometheusPushLabelsFromParts(args: {
  compoundMetric: string;
  intentId: string;
  conditionId: string;
  unit: string;
}): Record<string, string> {
  const parsed = ObservationTool.parseMetricCompound(args.compoundMetric);
  const labels = prometheusQueryLabels({
    compoundMetric: args.compoundMetric,
    intentId: args.intentId,
    conditionId: parsed?.conditionId ?? args.conditionId
  });
  labels.unit = args.unit || "NA";
  return labels;
}

function prometheusPushLabels(ctx: ObservationPersistContext): Record<string, string> {
  return prometheusPushLabelsFromParts({
    compoundMetric: ctx.compoundMetric,
    intentId: ctx.intentId,
    conditionId: ctx.conditionId,
    unit: ctx.unit
  });
}

export function obtainedAtToMs(iso: string): number | undefined {
  const trimmed = iso?.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : undefined;
}

export function prometheusSampleFromParts(args: {
  compoundMetric: string;
  intentId: string;
  conditionId: string;
  unit: string;
  value: number;
  obtainedAt: string;
}): PrometheusSample {
  return {
    metricName: toPrometheusMetricName(args.compoundMetric),
    value: args.value,
    labels: prometheusPushLabelsFromParts(args),
    timestampMs: obtainedAtToMs(args.obtainedAt)
  };
}

function toPrometheusSample(ctx: ObservationPersistContext): PrometheusSample {
  return prometheusSampleFromParts({
    compoundMetric: ctx.compoundMetric,
    intentId: ctx.intentId,
    conditionId: ctx.conditionId,
    unit: ctx.unit,
    value: ctx.payload.value,
    obtainedAt: ctx.payload.obtainedAt
  });
}

const bufferedSamples: PrometheusSample[] = [];
let bufferedTool: PrometheusTool | null = null;

export function resetPrometheusBufferForTests(): void {
  bufferedSamples.length = 0;
  bufferedTool = null;
}

export function readPrometheusFlushChunkSize(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.SYNTH_OBS_PROM_FLUSH_CHUNK?.trim();
  if (!raw) return DEFAULT_SYNTH_OBS_PROM_FLUSH_CHUNK;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SYNTH_OBS_PROM_FLUSH_CHUNK;
  return Math.floor(parsed);
}

export function initPrometheusSampleBuffer(
  pushgatewayUrl?: string,
  prometheusUrl?: string,
  remoteWriteUrl?: string,
): void {
  if (!bufferedTool) {
    createPrometheusObservationBackend(pushgatewayUrl, prometheusUrl, remoteWriteUrl);
  }
}

export function bufferedPrometheusSampleCount(): number {
  return bufferedSamples.length;
}

export function bufferPrometheusSample(sample: PrometheusSample): void {
  if (!bufferedTool) {
    initPrometheusSampleBuffer();
  }
  bufferedSamples.push(sample);
}

function inferFlushIntentId(
  batch: PrometheusSample[],
  ctx?: PrometheusRemoteWriteFlushContext,
): string | undefined {
  if (ctx?.intentId?.trim()) return ctx.intentId.trim();
  const intentId = batch[0]?.labels?.intent_id;
  return typeof intentId === "string" && intentId.length > 0 ? intentId : undefined;
}

async function remoteWriteBufferedBatch(
  batch: PrometheusSample[],
  ctx?: PrometheusRemoteWriteFlushContext,
): Promise<PrometheusRemoteWriteFlushResult> {
  const tool = bufferedTool;
  if (!tool) {
    const message = "Prometheus remote write flush failed: backend not initialized";
    appendObservationError({
      kind: "prometheus_remote_write_flush_failed",
      message,
      intentId: ctx?.intentId,
      metric: ctx?.metric,
      sessionId: ctx?.sessionId,
    });
    process.stderr.write(`Warning: ${message}\n`);
    return { ok: false, sampleCount: 0, error: message };
  }

  const result = await packageTraceToolCall(
    "prometheus_write",
    {
      sampleCount: batch.length,
      intentId: inferFlushIntentId(batch, ctx),
      metric: ctx?.metric,
      mode: "remote_write"
    },
    () => tool.remoteWriteBatch(batch)
  );
  if (!result.ok) {
    const message =
      result.error ??
      `Prometheus remote write flush failed for ${result.sampleCount || batch.length} buffered samples`;
    appendObservationError({
      kind: "prometheus_remote_write_flush_failed",
      message,
      intentId: inferFlushIntentId(batch, ctx),
      metric: ctx?.metric,
      sessionId: ctx?.sessionId,
      sampleCount: result.sampleCount || batch.length,
      remoteWriteUrl: result.remoteWriteUrl,
    });
    process.stderr.write(`Warning: ${message}\n`);
    return {
      ok: false,
      sampleCount: result.sampleCount || batch.length,
      error: message,
    };
  }

  return { ok: true, sampleCount: result.sampleCount };
}

/** Flush all buffered samples (historic end-of-run or chunk size 0). */
export async function flushBufferedPrometheusRemoteWrite(
  ctx?: PrometheusRemoteWriteFlushContext,
): Promise<PrometheusRemoteWriteFlushResult> {
  if (bufferedSamples.length === 0) {
    return { ok: true, sampleCount: 0 };
  }
  const batch = bufferedSamples.splice(0, bufferedSamples.length);
  return remoteWriteBufferedBatch(batch, ctx);
}

/**
 * Flush up to `chunkSize` buffered samples (or all when `force`).
 * When chunk size is 0, only flushes when `force` is true.
 */
export async function flushBufferedPrometheusRemoteWriteChunk(
  ctx?: PrometheusRemoteWriteFlushContext,
  options?: { force?: boolean; chunkSize?: number },
): Promise<PrometheusRemoteWriteChunkFlushResult> {
  const chunkSize = options?.chunkSize ?? readPrometheusFlushChunkSize();
  const force = options?.force === true;

  if (bufferedSamples.length === 0) {
    return { ok: true, sampleCount: 0, remainingBuffered: 0 };
  }

  if (!force && chunkSize <= 0) {
    return {
      ok: true,
      sampleCount: 0,
      remainingBuffered: bufferedSamples.length,
    };
  }

  const takeCount = force
    ? bufferedSamples.length
    : Math.min(chunkSize, bufferedSamples.length);

  if (!force && bufferedSamples.length < chunkSize) {
    return {
      ok: true,
      sampleCount: 0,
      remainingBuffered: bufferedSamples.length,
    };
  }

  const batch = bufferedSamples.splice(0, takeCount);
  const result = await remoteWriteBufferedBatch(batch, ctx);
  return {
    ...result,
    remainingBuffered: bufferedSamples.length,
  };
}

export function createPrometheusObservationBackend(
  pushgatewayUrl?: string,
  prometheusUrl?: string,
  remoteWriteUrl?: string
) {
  const tool = PrometheusTool.fromEnv(pushgatewayUrl, prometheusUrl, remoteWriteUrl);
  bufferedTool = tool;

  return {
    id: "prometheus" as const,

    async persistObservation(ctx: ObservationPersistContext): Promise<boolean> {
      const sample = toPrometheusSample(ctx);
      if (ctx.prometheusWriteMode === "buffer") {
        bufferedSamples.push(sample);
        return true;
      }
      const pushed = await packageTraceToolCall(
        "prometheus_write",
        {
          sampleCount: 1,
          intentId: ctx.intentId,
          metric: ctx.compoundMetric,
          mode: "pushgateway"
        },
        () => tool.pushSample(sample)
      );
      if (!pushed && ctx.prometheusWriteMode !== "buffer") {
        const message = `Prometheus Pushgateway push failed for metric ${ctx.compoundMetric}`;
        appendObservationError({
          kind: "prometheus_push_failed",
          message,
          intentId: ctx.intentId,
          metric: ctx.compoundMetric,
          sampleCount: 1,
        });
        process.stderr.write(`Warning: ${message}\n`);
      }
      return pushed;
    },

    async registerMetricMetadata(ctx: ObservationPersistContext): Promise<boolean> {
      const parsed = ObservationTool.parseMetricCompound(ctx.compoundMetric);
      return ctx.graphTool.storePrometheusMetadata(ctx.compoundMetric, tool.prometheusQueryBaseUrl, {
        intentId: ctx.intentId,
        conditionId: parsed?.conditionId ?? ctx.conditionId
      });
    }
  };
}
