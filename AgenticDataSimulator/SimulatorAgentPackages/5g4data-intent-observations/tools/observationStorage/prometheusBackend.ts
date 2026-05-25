import { ObservationTool } from "../observationTool.js";
import {
  prometheusQueryLabels,
  toPrometheusMetricName
} from "../prometheusMetricNaming.js";
import { PrometheusTool, type PrometheusSample } from "../prometheusTool.js";
import type { ObservationPersistContext } from "./persistContext.js";

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

export async function flushBufferedPrometheusRemoteWrite(): Promise<boolean> {
  if (bufferedSamples.length === 0) return true;
  const tool = bufferedTool;
  if (!tool) return false;
  const batch = bufferedSamples.splice(0, bufferedSamples.length);
  const ok = await tool.remoteWriteBatch(batch);
  if (!ok) {
    process.stderr.write(
      `Warning: Prometheus remote write flush failed for ${batch.length} buffered samples\n`
    );
  }
  return ok;
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
      return tool.pushSample(sample);
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
