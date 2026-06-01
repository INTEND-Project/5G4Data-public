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

function prometheusPushLabels(ctx: ObservationPersistContext): Record<string, string> {
  const parsed = ObservationTool.parseMetricCompound(ctx.compoundMetric);
  const labels = prometheusQueryLabels({
    compoundMetric: ctx.compoundMetric,
    intentId: ctx.intentId,
    conditionId: parsed?.conditionId ?? ctx.conditionId
  });
  labels.unit = ctx.unit || "NA";
  return labels;
}

export function obtainedAtToMs(iso: string): number | undefined {
  const trimmed = iso?.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : undefined;
}

function toPrometheusSample(ctx: ObservationPersistContext): PrometheusSample {
  return {
    metricName: toPrometheusMetricName(ctx.compoundMetric),
    value: ctx.payload.value,
    labels: prometheusPushLabels(ctx),
    timestampMs: obtainedAtToMs(ctx.payload.obtainedAt)
  };
}

const bufferedSamples: PrometheusSample[] = [];
let bufferedTool: PrometheusTool | null = null;

export function resetPrometheusBufferForTests(): void {
  bufferedSamples.length = 0;
  bufferedTool = null;
}

function inferFlushIntentId(
  batch: PrometheusSample[],
  ctx?: PrometheusRemoteWriteFlushContext,
): string | undefined {
  if (ctx?.intentId?.trim()) return ctx.intentId.trim();
  const intentId = batch[0]?.labels?.intent_id;
  return typeof intentId === "string" && intentId.length > 0 ? intentId : undefined;
}

export async function flushBufferedPrometheusRemoteWrite(
  ctx?: PrometheusRemoteWriteFlushContext,
): Promise<PrometheusRemoteWriteFlushResult> {
  if (bufferedSamples.length === 0) {
    return { ok: true, sampleCount: 0 };
  }
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

  const batch = bufferedSamples.splice(0, bufferedSamples.length);
  const result = await tool.remoteWriteBatch(batch);
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
      const pushed = await tool.pushSample(sample);
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
