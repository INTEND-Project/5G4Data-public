import { graphDbAuthHeaders } from "@/lib/graphdb/auth";
import { INTENT_REPORTS_METADATA_GRAPH_IRI } from "@/lib/graphdb/clear-knowledge-graph-query";
import { resolveGraphDbBaseUrl } from "@/lib/graphdb/resolve-base-url";
import { graphIriForSparqlAngleBrackets, parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";
import { resolveIntentMetricCatalog } from "@/lib/kg/resolve-intent-metric-catalog";
import { parseCompoundMetricParts } from "@/lib/prometheus/parse-compound-metric";
import {
  buildPrometheusInstantQueryUrl,
  buildPrometheusReadableQuery,
} from "@/lib/prometheus/prometheus-query-metadata";
import { resolvePrometheusExecutorBaseUrl } from "@/lib/prometheus/resolve-executor-base-url";

function escapeTurtleString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function metricSubjectIri(compoundMetric: string): string {
  return `<http://5g4data.eu/5g4data#${compoundMetric}>`;
}

export function buildDeletePrometheusMetadataUpdate(compoundMetric: string): string {
  const graphIri = graphIriForSparqlAngleBrackets(INTENT_REPORTS_METADATA_GRAPH_IRI);
  const subject = metricSubjectIri(compoundMetric);

  return `
PREFIX data5g: <http://5g4data.eu/5g4data#>

DELETE {
  GRAPH <${graphIri}> {
    ${subject} data5g:hasQuery ?q .
    ${subject} data5g:hasReadableQuery ?r .
  }
}
WHERE {
  GRAPH <${graphIri}> {
    ${subject} data5g:hasQuery ?q .
    OPTIONAL { ${subject} data5g:hasReadableQuery ?r . }
  }
}
`.trim();
}

function buildInsertPrometheusMetadataUpdate(input: {
  compoundMetric: string;
  prometheusQueryUrl: string;
  readableQuery: string;
}): string {
  const escapedReadable = escapeTurtleString(input.readableQuery);
  const graphIri = graphIriForSparqlAngleBrackets(INTENT_REPORTS_METADATA_GRAPH_IRI);

  return `
PREFIX data5g: <http://5g4data.eu/5g4data#>

INSERT DATA {
  GRAPH <${graphIri}> {
    ${metricSubjectIri(input.compoundMetric)}
      data5g:hasQuery <${input.prometheusQueryUrl}> ;
      data5g:hasReadableQuery "${escapedReadable}" .
  }
}
`.trim();
}

async function postMetadataUpdate(
  repositoryId: string,
  query: string,
  graphDbBaseUrl?: string | null,
): Promise<void> {
  const base = resolveGraphDbBaseUrl(graphDbBaseUrl);
  const url = `${base}repositories/${encodeURIComponent(repositoryId)}/statements`;

  const response = await fetch(url, {
    method: "POST",
    headers: graphDbAuthHeaders({
      "Content-Type": "application/sparql-update",
    }),
    body: query,
  });

  if (!response.ok) {
    throw new Error(`GraphDB metadata insert failed with ${response.status}`);
  }
}

export async function listCompoundMetricsForIntent(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  graphDbBaseUrl?: string | null;
}): Promise<string[]> {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(input.intentId);
  if (!intentLocalId) {
    return [];
  }

  return resolveIntentMetricCatalog({
    repositoryId: input.repositoryId,
    graphIri: input.graphIri,
    intentId: intentLocalId,
    graphDbBaseUrl: input.graphDbBaseUrl,
  });
}

export async function storePrometheusQueryMetadata(input: {
  repositoryId: string;
  intentId: string;
  compoundMetric: string;
  /** Workspace Prometheus base URL for hasQuery embedding. */
  prometheusBaseUrl?: string | null;
  graphDbBaseUrl?: string | null;
}): Promise<void> {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(input.intentId);
  if (!intentLocalId) {
    return;
  }

  const baseUrl = resolvePrometheusExecutorBaseUrl(input.prometheusBaseUrl);
  const { conditionId } = parseCompoundMetricParts(input.compoundMetric);
  const identity = {
    compoundMetric: input.compoundMetric,
    intentId: intentLocalId,
    conditionId,
  };

  const readableQuery = buildPrometheusReadableQuery(identity);
  const prometheusQueryUrl = buildPrometheusInstantQueryUrl(baseUrl, identity);
  const deleteUpdate = buildDeletePrometheusMetadataUpdate(input.compoundMetric);
  const insertUpdate = buildInsertPrometheusMetadataUpdate({
    compoundMetric: input.compoundMetric,
    prometheusQueryUrl,
    readableQuery,
  });

  await postMetadataUpdate(input.repositoryId, deleteUpdate, input.graphDbBaseUrl);
  await postMetadataUpdate(input.repositoryId, insertUpdate, input.graphDbBaseUrl);
}

export async function storePrometheusMetadataForIntent(input: {
  repositoryId: string;
  graphIri: string;
  intentId: string;
  prometheusBaseUrl?: string | null;
  graphDbBaseUrl?: string | null;
}): Promise<{ stored: number; failed: number }> {
  const metrics = await listCompoundMetricsForIntent(input);
  let stored = 0;
  let failed = 0;

  for (const compoundMetric of metrics) {
    try {
      await storePrometheusQueryMetadata({
        repositoryId: input.repositoryId,
        intentId: input.intentId,
        compoundMetric,
        prometheusBaseUrl: input.prometheusBaseUrl,
        graphDbBaseUrl: input.graphDbBaseUrl,
      });
      stored += 1;
    } catch {
      failed += 1;
    }
  }

  return { stored, failed };
}
