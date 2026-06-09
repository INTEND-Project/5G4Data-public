import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import {
  graphIriForSparqlAngleBrackets,
  parseIntentLocalIdForMetricCatalog,
} from "@/lib/kg/metric-catalog-query";
import { resolveIntentMetricCatalog } from "@/lib/kg/resolve-intent-metric-catalog";
import {
  compoundMetricsForBackend,
  fetchMetricQueryMetadata,
  metadataUsesBackend,
  type MetricQueryMetadata,
} from "@/lib/kg/metric-query-metadata";
import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";

export type ObservationTimeBounds = {
  minMs: number;
  maxMs: number;
};

const STREAMING_RECENCY_MS = 10 * 60 * 1000;
/** Maximum lookback for Grafana time-range and bounds queries (6 calendar months). */
export const MAX_OBSERVATION_LOOKBACK_MS = 183 * 24 * 60 * 60 * 1000;

function formatXsdDateTimeUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function earliestObservationLookbackMs(nowMs = Date.now()): number {
  return nowMs - MAX_OBSERVATION_LOOKBACK_MS;
}

export function clampBoundsForGrafana(
  bounds: ObservationTimeBounds,
  nowMs = Date.now(),
): ObservationTimeBounds {
  const floorMs = earliestObservationLookbackMs(nowMs);
  return {
    minMs: Math.max(bounds.minMs, floorMs),
    maxMs: bounds.maxMs,
  };
}

function buildGraphDbObservationBoundsQuery(
  graphIriRaw: string,
  metricLocalNames: string[],
  nowMs = Date.now(),
): string {
  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const metricValues = metricLocalNames
    .map((name) => `<http://5g4data.eu/5g4data#${name}>`)
    .join(" ");
  const lookbackFloor = formatXsdDateTimeUtc(earliestObservationLookbackMs(nowMs));

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
    FILTER (?obtainedAt >= "${lookbackFloor}"^^xsd:dateTime)
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
  graphDbBaseUrl?: string | null;
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
      graphDbBaseUrl: input.graphDbBaseUrl,
    });
    const row = bindings[0];
    const minMs = parseXsdDateTimeMs(row?.minAt?.value);
    const maxMs = parseXsdDateTimeMs(row?.maxAt?.value);

    if (minMs === null || maxMs === null) {
      return null;
    }

    return clampBoundsForGrafana({ minMs, maxMs });
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

export async function fetchPrometheusObservationBounds(
  intentId: string,
  prometheusBaseUrl?: string | null,
): Promise<ObservationTimeBounds | null> {
  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentId);
  if (!intentLocalId) {
    return null;
  }

  const match = `{intent_id="${intentLocalId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;
  const nowMs = Date.now();
  const end = Math.floor(nowMs / 1000);
  const start = Math.floor(earliestObservationLookbackMs(nowMs) / 1000);
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

  return clampBoundsForGrafana({ minMs, maxMs }, nowMs);
}

function mergeObservationBounds(
  left: ObservationTimeBounds | null,
  right: ObservationTimeBounds | null,
): ObservationTimeBounds | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    minMs: Math.min(left.minMs, right.minMs),
    maxMs: Math.max(left.maxMs, right.maxMs),
  };
}

/**
 * Resolves Grafana time bounds using `intent-reports-metadata` (`data5g:hasQuery`) to
 * decide whether to probe Prometheus or GraphDB. Falls back to both when metadata is missing.
 */
export async function resolveObservationTimeBounds(input: {
  intentId: string;
  repositoryId?: string | null;
  graphIri?: string | null;
  compoundMetrics: string[];
  metricMetadata?: MetricQueryMetadata[];
}): Promise<ObservationTimeBounds | null> {
  const repositoryId = input.repositoryId?.trim();
  const graphIri = input.graphIri?.trim();

  const metadata =
    input.metricMetadata ??
    (repositoryId
      ? await fetchMetricQueryMetadata(repositoryId, input.compoundMetrics)
      : []);

  const usePrometheus =
    metadata.length === 0 || metadataUsesBackend(metadata, "prometheus");
  const useGraphDb =
    metadata.length === 0 || metadataUsesBackend(metadata, "graphdb");

  let bounds: ObservationTimeBounds | null = null;

  if (usePrometheus) {
    bounds = mergeObservationBounds(bounds, await fetchPrometheusObservationBounds(input.intentId));
  }

  if (useGraphDb && repositoryId && graphIri) {
    const graphdbMetrics =
      metadata.length > 0
        ? compoundMetricsForBackend(metadata, "graphdb")
        : input.compoundMetrics;

    if (graphdbMetrics.length > 0) {
      bounds = mergeObservationBounds(
        bounds,
        await fetchGraphDbObservationBounds({
          repositoryId,
          graphIri,
          compoundMetrics: graphdbMetrics,
        }),
      );
    }
  }

  return bounds;
}

export function isStreamingBounds(bounds: ObservationTimeBounds | null, nowMs = Date.now()): boolean {
  if (!bounds) {
    return true;
  }

  return nowMs - bounds.maxMs <= STREAMING_RECENCY_MS;
}

export function historicGrafanaWindow(
  bounds: ObservationTimeBounds,
  nowMs = Date.now(),
): { fromMs: number; toMs: number } {
  const clamped = clampBoundsForGrafana(bounds, nowMs);
  const span = Math.max(clamped.maxMs - clamped.minMs, 60_000);
  const padding = Math.max(Math.floor(span * 0.05), 60_000);

  return {
    fromMs: Math.max(clamped.minMs, earliestObservationLookbackMs(nowMs)),
    toMs: clamped.maxMs + padding,
  };
}

export async function fetchCompoundMetricsForIntent(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  graphDbBaseUrl?: string | null;
}): Promise<string[]> {
  try {
    return await resolveIntentMetricCatalog(input);
  } catch {
    return [];
  }
}
