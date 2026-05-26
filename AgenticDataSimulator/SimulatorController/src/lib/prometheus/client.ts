import { loadAppEnv } from "@/lib/env";
import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";
import {
  normalizePrometheusBaseUrl,
  normalizePushgatewayBaseUrl,
} from "@/lib/prometheus/urls";

const INTENT_REPORTS_JOB = "intent_reports";

type LabelValuesResponse = {
  status?: string;
  data?: string[];
};

export type ClearIntentMetricsResult = {
  intentId: string;
  pushgatewayCleared: boolean;
  tsdbSeriesDeleted: boolean;
  tombstonesCleaned: boolean;
};

function prometheusBaseUrlFromEnv(): string {
  const env = loadAppEnv(process.env);
  return normalizePrometheusBaseUrl(env.prometheusUrl);
}

function pushgatewayBaseUrlFromEnv(): string {
  const env = loadAppEnv(process.env);
  return normalizePushgatewayBaseUrl(env.pushgatewayUrl);
}

export function validateIntentIdForPrometheusClear(raw: string): string | null {
  return parseIntentLocalIdForMetricCatalog(raw);
}

export async function listIntentIds(): Promise<string[]> {
  const baseUrl = prometheusBaseUrlFromEnv();
  const response = await fetch(
    `${baseUrl}api/v1/label/intent_id/values`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`Prometheus intent_id label query failed with ${response.status}`);
  }

  const payload = (await response.json()) as LabelValuesResponse;
  const values = payload.data ?? [];
  return [...values].sort((left, right) => left.localeCompare(right));
}

function pushgatewayIntentGroupUrl(intentId: string): string {
  const base = pushgatewayBaseUrlFromEnv();
  return `${base}/metrics/job/${encodeURIComponent(INTENT_REPORTS_JOB)}/intent_id/${encodeURIComponent(intentId)}`;
}

async function clearPushgatewayIntentGroup(intentId: string): Promise<boolean> {
  const response = await fetch(pushgatewayIntentGroupUrl(intentId), {
    method: "DELETE",
  });

  return response.ok || response.status === 404;
}

async function deletePrometheusSeries(intentId: string): Promise<void> {
  const baseUrl = prometheusBaseUrlFromEnv();
  const match = `{intent_id="${intentId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;
  const url = `${baseUrl}api/v1/admin/tsdb/delete_series?${new URLSearchParams({
    "match[]": match,
  }).toString()}`;

  const response = await fetch(url, { method: "POST" });

  if (!response.ok) {
    throw new Error(`Prometheus delete_series failed with ${response.status}`);
  }
}

async function cleanPrometheusTombstones(): Promise<void> {
  const baseUrl = prometheusBaseUrlFromEnv();
  const response = await fetch(`${baseUrl}api/v1/admin/tsdb/clean_tombstones`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Prometheus clean_tombstones failed with ${response.status}`);
  }
}

export async function clearIntentMetrics(intentIdRaw: string): Promise<ClearIntentMetricsResult> {
  const intentId = validateIntentIdForPrometheusClear(intentIdRaw);

  if (!intentId) {
    throw new Error("intentId must be canonical I + 32 hex characters");
  }

  const pushgatewayCleared = await clearPushgatewayIntentGroup(intentId);
  await deletePrometheusSeries(intentId);
  await cleanPrometheusTombstones();

  return {
    intentId,
    pushgatewayCleared,
    tsdbSeriesDeleted: true,
    tombstonesCleaned: true,
  };
}
