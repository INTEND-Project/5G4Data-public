import { loadAppEnv } from "@/lib/env";
import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";
import { runIntentTsdbRewrite } from "@/lib/prometheus/tsdb-intent-rewrite";
import {
  normalizePrometheusBaseUrl,
  normalizePushgatewayBaseUrl,
} from "@/lib/prometheus/urls";

const INTENT_REPORTS_JOB = "intent_reports";

/** Slightly wider than prometheus.yml out_of_order_time_window (365d). */
const INTENT_SAMPLE_LOOKBACK = "400d";

type LabelValuesResponse = {
  status?: string;
  data?: string[];
};

type SeriesResponse = {
  status?: string;
  data?: Array<Record<string, string>>;
};

type QueryResponse = {
  status?: string;
  data?: {
    resultType?: string;
    result?: Array<{
      value?: [number, string];
    }>;
  };
};

export type ClearIntentMetricsResult = {
  intentId: string;
  pushgatewayCleared: boolean;
  tsdbSeriesDeleted: boolean;
  tombstonesCleaned: boolean;
  verifiedEmpty: boolean;
  samplesRemaining: number;
  oooRewriteFallbackUsed: boolean;
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

function escapePrometheusLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildIntentMatcher(intentId: string): string {
  return `{intent_id="${escapePrometheusLabelValue(intentId)}"}`;
}

function buildSeriesMatcher(labels: Record<string, string>): string {
  const parts = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}="${escapePrometheusLabelValue(value)}"`);

  return `{${parts.join(",")}}`;
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

async function listPrometheusSeriesForIntent(intentId: string): Promise<Array<Record<string, string>>> {
  const baseUrl = prometheusBaseUrlFromEnv();
  const url = `${baseUrl}api/v1/series?${new URLSearchParams({
    "match[]": buildIntentMatcher(intentId),
  }).toString()}`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Prometheus series query failed with ${response.status}`);
  }

  const payload = (await response.json()) as SeriesResponse;
  return payload.data ?? [];
}

async function postDeleteSeries(match: string, start?: number, end?: number): Promise<void> {
  const baseUrl = prometheusBaseUrlFromEnv();
  const params = new URLSearchParams({ "match[]": match });

  if (start !== undefined) {
    params.set("start", String(start));
  }

  if (end !== undefined) {
    params.set("end", String(end));
  }

  const response = await fetch(`${baseUrl}api/v1/admin/tsdb/delete_series?${params.toString()}`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Prometheus delete_series failed with ${response.status}`);
  }
}

async function deletePrometheusSeriesForIntent(intentId: string): Promise<void> {
  const matchers = new Set<string>([buildIntentMatcher(intentId)]);

  const series = await listPrometheusSeriesForIntent(intentId);

  for (const labels of series) {
    matchers.add(buildSeriesMatcher(labels));
  }

  for (const match of matchers) {
    await postDeleteSeries(match);
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

async function countIntentSamples(intentId: string): Promise<number> {
  const baseUrl = prometheusBaseUrlFromEnv();
  const matcher = buildIntentMatcher(intentId);
  const query = `sum(count_over_time(${matcher}[${INTENT_SAMPLE_LOOKBACK}]))`;
  const url = `${baseUrl}api/v1/query?${new URLSearchParams({ query }).toString()}`;

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Prometheus sample verification query failed with ${response.status}`);
  }

  const payload = (await response.json()) as QueryResponse;
  const value = payload.data?.result?.[0]?.value?.[1];

  if (value === undefined) {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export async function clearIntentMetrics(intentIdRaw: string): Promise<ClearIntentMetricsResult> {
  const intentId = validateIntentIdForPrometheusClear(intentIdRaw);

  if (!intentId) {
    throw new Error("intentId must be canonical I + 32 hex characters");
  }

  const pushgatewayCleared = await clearPushgatewayIntentGroup(intentId);
  await deletePrometheusSeriesForIntent(intentId);
  await cleanPrometheusTombstones();

  let samplesRemaining = await countIntentSamples(intentId);
  let oooRewriteFallbackUsed = false;

  if (samplesRemaining > 0) {
    await runIntentTsdbRewrite(intentId);
    oooRewriteFallbackUsed = true;
    samplesRemaining = await countIntentSamples(intentId);
  }

  if (samplesRemaining > 0) {
    throw new Error(
      `Prometheus still has ${samplesRemaining} sample(s) for intent ${intentId} after TSDB clear`,
    );
  }

  return {
    intentId,
    pushgatewayCleared,
    tsdbSeriesDeleted: true,
    tombstonesCleaned: true,
    verifiedEmpty: true,
    samplesRemaining: 0,
    oooRewriteFallbackUsed,
  };
}
