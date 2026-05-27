import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import { loadAppEnv } from "@/lib/env";
import {
  buildMetricCatalogQuery,
  graphIriForSparqlAngleBrackets,
  parseIntentLocalIdForMetricCatalog,
} from "@/lib/kg/metric-catalog-query";
import { normalizePrometheusBaseUrl } from "@/lib/prometheus/urls";

export type ObservationTimeBounds = {
  minMs: number;
  maxMs: number;
};

const STREAMING_RECENCY_MS = 10 * 60 * 1000;

function buildGraphDbObservationBoundsQuery(graphIriRaw: string, metricLocalNames: string[]): string {
  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const metricValues = metricLocalNames
    .map((name) => `<http://5g4data.eu/5g4data#${name}>`)
    .join(" ");

  return `
PREFIX met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT (MIN(?obtainedAt) AS ?minAt) (MAX(?obtainedAt) AS ?maxAt)
WHERE {
  GRAPH <${graphIri}> {
    ?obs a met:Observation ;
         met:observedMetric ?metric ;
         met:obtainedAt ?obtainedAt .
    VALUES ?metric { ${metricValues} }
  }
}
`.trim();
}

function parseXsdDateTimeMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchGraphDbObservationBounds(input: {
  repositoryId: string;
  graphIri: string;
  compoundMetrics: string[];
}): Promise<ObservationTimeBounds | null> {
  if (input.compoundMetrics.length === 0) {
    return null;
  }

  let query: string;
  try {
    query = buildGraphDbObservationBoundsQuery(input.graphIri, input.compoundMetrics);
  } catch {
    return null;
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: input.repositoryId,
      query,
    });
    const row = bindings[0];
    const minMs = parseXsdDateTimeMs(row?.minAt?.value);
    const maxMs = parseXsdDateTimeMs(row?.maxAt?.value);

    if (minMs === null || maxMs === null) {
      return null;
    }

    return { minMs, maxMs };
  } catch {
    return null;
  }
}

type PrometheusQueryRangeResponse = {
  status?: string;
  data?: {
    result?: Array<{
      values?: Array<[number, string]>;
    }>;
  };
};

export async function fetchPrometheusObservationBounds(intentId: string): Promise<ObservationTimeBounds | null> {
  const env = loadAppEnv(process.env);
  const baseUrl = normalizePrometheusBaseUrl(env.prometheusUrl);
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentId);
  if (!intentLocalId) {
    return null;
  }

  const match = `{intent_id="${intentLocalId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 365 * 24 * 60 * 60;
  const params = new URLSearchParams({
    query: match,
    start: String(start),
    end: String(end),
    step: "3600",
  });

  const response = await fetch(`${baseUrl}api/v1/query_range?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as PrometheusQueryRangeResponse;
  const series = payload.data?.result ?? [];

  let minMs: number | null = null;
  let maxMs: number | null = null;

  for (const entry of series) {
    for (const [timestamp] of entry.values ?? []) {
      const ms = timestamp * 1000;
      if (minMs === null || ms < minMs) {
        minMs = ms;
      }
      if (maxMs === null || ms > maxMs) {
        maxMs = ms;
      }
    }
  }

  if (minMs === null || maxMs === null) {
    return null;
  }

  return { minMs, maxMs };
}

export function isStreamingBounds(bounds: ObservationTimeBounds | null, nowMs = Date.now()): boolean {
  if (!bounds) {
    return true;
  }

  return nowMs - bounds.maxMs <= STREAMING_RECENCY_MS;
}

export function historicGrafanaWindow(bounds: ObservationTimeBounds): { fromMs: number; toMs: number } {
  const span = Math.max(bounds.maxMs - bounds.minMs, 60_000);
  const padding = Math.max(Math.floor(span * 0.05), 60_000);

  return {
    fromMs: bounds.minMs - padding,
    toMs: bounds.maxMs + padding,
  };
}

export async function fetchCompoundMetricsForIntent(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
}): Promise<string[]> {
  let query: string;
  try {
    query = buildMetricCatalogQuery(input.graphIri, input.intentId);
  } catch {
    return [];
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: input.repositoryId,
      query,
    });

    return bindings
      .map((row) => row.metric_name?.value?.trim())
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}
