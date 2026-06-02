import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import { INTENT_REPORTS_METADATA_GRAPH_IRI } from "@/lib/graphdb/clear-knowledge-graph-query";
import { graphIriForSparqlAngleBrackets } from "@/lib/kg/metric-catalog-query";
import {
  DEFAULT_OBSERVATION_STORAGE,
  type ObservationStorageType,
} from "@/lib/observation-storage";

export type MetricQueryBackend = "prometheus" | "graphdb" | "unknown";

export type MetricQueryMetadata = {
  compoundMetric: string;
  queryUrl: string;
  backend: MetricQueryBackend;
};

/** One row per compound metric (GraphDB may contain duplicate `hasQuery` INSERTs). */
export function dedupeMetricQueryMetadata(
  metadata: MetricQueryMetadata[],
): MetricQueryMetadata[] {
  const seen = new Set<string>();
  const unique: MetricQueryMetadata[] = [];
  for (const entry of metadata) {
    if (seen.has(entry.compoundMetric)) {
      continue;
    }
    seen.add(entry.compoundMetric);
    unique.push(entry);
  }
  return unique;
}

/** Classify retrieval URL stored in `data5g:hasQuery` (same heuristics as IntentReportQueryProxy). */
export function classifyMetricQueryUrl(queryUrl: string): MetricQueryBackend {
  const url = queryUrl.trim();
  if (!url) {
    return "unknown";
  }

  if (
    url.includes("api/v1/query") ||
    url.includes("api/v1/query_range") ||
    url.includes(":9090")
  ) {
    return "prometheus";
  }

  if (url.includes("/repositories/") && url.includes("query=")) {
    return "graphdb";
  }

  return "unknown";
}

function buildMetricQueryMetadataQuery(compoundMetrics: string[]): string {
  const metadataGraph = graphIriForSparqlAngleBrackets(INTENT_REPORTS_METADATA_GRAPH_IRI);
  const metricValues = compoundMetrics
    .map((name) => `<http://5g4data.eu/5g4data#${name}>`)
    .join(" ");

  return `
PREFIX data5g: <http://5g4data.eu/5g4data#>

SELECT ?metric ?query
WHERE {
  GRAPH <${metadataGraph}> {
    VALUES ?metric { ${metricValues} }
    ?metric data5g:hasQuery ?query .
  }
}
`.trim();
}

export async function fetchMetricQueryMetadata(
  repositoryId: string,
  compoundMetrics: string[],
  graphDbBaseUrl?: string | null,
): Promise<MetricQueryMetadata[]> {
  if (compoundMetrics.length === 0) {
    return [];
  }

  let query: string;
  try {
    query = buildMetricQueryMetadataQuery(compoundMetrics);
  } catch {
    return [];
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId,
      query,
      graphDbBaseUrl,
    });

    const rows = bindings
      .map((row) => {
        const metricIri = row.metric?.value?.trim();
        const queryUrl = row.query?.value?.trim();
        if (!metricIri || !queryUrl) {
          return null;
        }

        const compoundMetric = metricIri.replace(/^.*#/, "");
        return {
          compoundMetric,
          queryUrl,
          backend: classifyMetricQueryUrl(queryUrl),
        } satisfies MetricQueryMetadata;
      })
      .filter((entry): entry is MetricQueryMetadata => Boolean(entry));

    return dedupeMetricQueryMetadata(rows);
  } catch {
    return [];
  }
}

export function resolveObservationStorageFromMetadata(
  metadata: MetricQueryMetadata[],
  inPrometheus: boolean,
): ObservationStorageType {
  const backends = new Set(
    metadata.map((entry) => entry.backend).filter((backend) => backend !== "unknown"),
  );

  if (backends.size === 1) {
    return backends.has("prometheus") ? "prometheus" : "graphdb";
  }

  if (backends.size > 1) {
    return backends.has("prometheus") ? "prometheus" : "graphdb";
  }

  if (inPrometheus) {
    return "prometheus";
  }

  return DEFAULT_OBSERVATION_STORAGE;
}

export function compoundMetricsForBackend(
  metadata: MetricQueryMetadata[],
  backend: MetricQueryBackend,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of dedupeMetricQueryMetadata(metadata)) {
    if (entry.backend !== backend || seen.has(entry.compoundMetric)) {
      continue;
    }
    seen.add(entry.compoundMetric);
    names.push(entry.compoundMetric);
  }
  return names;
}

export function metadataUsesBackend(
  metadata: MetricQueryMetadata[],
  backend: MetricQueryBackend,
): boolean {
  return metadata.some((entry) => entry.backend === backend);
}
