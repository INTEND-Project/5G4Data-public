import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";
import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";
import {
  isLocalPrometheusStack,
  resolvePushgatewayBaseUrl,
  usesPushgatewayForStreaming,
} from "@/lib/prometheus/resolve-stack-urls";
import { runIntentTsdbRewrite } from "@/lib/prometheus/tsdb-intent-rewrite";
import { normalizePushgatewayBaseUrl } from "@/lib/prometheus/urls";

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

export type ClearIntentMetricsOptions = {
  prometheusBaseUrl?: string | null;
};

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

export function validateIntentIdForPrometheusClear(raw: string): string | null {
  return parseIntentLocalIdForMetricCatalog(raw);
}

export async function listIntentIds(prometheusBaseUrl?: string | null): Promise<string[]> {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
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

function pushgatewayIntentGroupUrl(intentId: string, pushgatewayBase: string): string {
  const base = normalizePushgatewayBaseUrl(pushgatewayBase);
  return `${base}/metrics/job/${encodeURIComponent(INTENT_REPORTS_JOB)}/intent_id/${encodeURIComponent(intentId)}`;
}

async function clearPushgatewayIntentGroup(
  intentId: string,
  pushgatewayBase: string,
): Promise<boolean> {
  const response = await fetch(pushgatewayIntentGroupUrl(intentId, pushgatewayBase), {
    method: "DELETE",
  });

  return response.ok || response.status === 404;
}

async function listPrometheusSeriesForIntent(
  intentId: string,
  prometheusBaseUrl?: string | null,
): Promise<Array<Record<string, string>>> {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
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

async function postDeleteSeries(
  match: string,
  prometheusBaseUrl?: string | null,
  start?: number,
  end?: number,
): Promise<void> {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
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

async function deletePrometheusSeriesForIntent(
  intentId: string,
  prometheusBaseUrl?: string | null,
): Promise<void> {
  const matchers = new Set<string>([buildIntentMatcher(intentId)]);

  const series = await listPrometheusSeriesForIntent(intentId, prometheusBaseUrl);

  for (const labels of series) {
    matchers.add(buildSeriesMatcher(labels));
  }

  for (const match of matchers) {
    await postDeleteSeries(match, prometheusBaseUrl);
  }
}

async function cleanPrometheusTombstones(prometheusBaseUrl?: string | null): Promise<void> {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
  const response = await fetch(`${baseUrl}api/v1/admin/tsdb/clean_tombstones`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Prometheus clean_tombstones failed with ${response.status}`);
  }
}

async function countIntentSamples(
  intentId: string,
  prometheusBaseUrl?: string | null,
): Promise<number> {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
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

export async function clearIntentMetrics(
  intentIdRaw: string,
  options: ClearIntentMetricsOptions = {},
): Promise<ClearIntentMetricsResult> {
  const intentId = validateIntentIdForPrometheusClear(intentIdRaw);

  if (!intentId) {
    throw new Error("intentId must be canonical I + 32 hex characters");
  }

  const baseUrl = resolvePrometheusBaseUrl(options.prometheusBaseUrl);
  const usePushgateway = usesPushgatewayForStreaming(baseUrl);

  const pushgatewayCleared = usePushgateway
    ? await clearPushgatewayIntentGroup(intentId, resolvePushgatewayBaseUrl())
    : true;

  await deletePrometheusSeriesForIntent(intentId, options.prometheusBaseUrl);
  await cleanPrometheusTombstones(options.prometheusBaseUrl);

  let samplesRemaining = await countIntentSamples(intentId, options.prometheusBaseUrl);
  let oooRewriteFallbackUsed = false;

  if (samplesRemaining > 0 && isLocalPrometheusStack(baseUrl)) {
    await runIntentTsdbRewrite(intentId);
    oooRewriteFallbackUsed = true;
    samplesRemaining = await countIntentSamples(intentId, options.prometheusBaseUrl);
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
