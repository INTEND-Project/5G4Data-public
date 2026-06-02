import { runRepositorySparqlSelect } from "@/lib/graphdb/client";
import { graphIriForSparqlAngleBrackets } from "@/lib/kg/metric-catalog-query";
import {
  compoundMetricsForBackend,
  type MetricQueryMetadata,
} from "@/lib/kg/metric-query-metadata";
import {
  earliestObservationLookbackMs,
  fetchGraphDbObservationBounds,
  fetchPrometheusObservationBounds,
  type ObservationTimeBounds,
} from "@/lib/intents/observation-time-bounds";
import type { ObservationStorageType } from "@/lib/observation-storage";
import { parseIntentLocalIdForMetricCatalog } from "@/lib/kg/metric-catalog-query";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import { toPrometheusMetricName } from "@/lib/prometheus/metric-naming";
import { resolvePrometheusBaseUrl } from "@/lib/prometheus/resolve-base-url";

export type IntentDataStatus = "pending" | "ready";

export type IntentDataReadiness = {
  status: IntentDataStatus;
  metricsReady: number;
  metricsTotal: number;
  bounds: ObservationTimeBounds | null;
};

function escapePrometheusLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function metricsExpectedForStorage(
  storage: ObservationStorageType,
  compoundMetrics: string[],
  metricMetadata: MetricQueryMetadata[],
): string[] {
  if (compoundMetrics.length === 0) {
    return [];
  }

  if (metricMetadata.length > 0) {
    const forStorage = compoundMetricsForBackend(metricMetadata, storage);
    if (forStorage.length > 0) {
      return forStorage;
    }
  }

  return compoundMetrics;
}

type PrometheusQueryResponse = {
  status?: string;
  data?: {
    result?: Array<{
      value?: [number, string];
    }>;
  };
};

async function prometheusMetricHasSamples(
  intentId: string,
  compoundMetric: string,
  prometheusBaseUrl?: string | null,
): Promise<boolean> {
  const intentLocalId = parseIntentLocalIdForMetricCatalog(intentId);
  if (!intentLocalId) {
    return false;
  }

  const baseUrl = resolvePrometheusBaseUrl(prometheusBaseUrl);
  const promName = toPrometheusMetricName(compoundMetric);
  const selector = `${promName}{intent_id="${escapePrometheusLabelValue(intentLocalId)}"}`;
  const query = `count_over_time(${selector}[400d])`;

  const response = await fetch(
    `${baseUrl}api/v1/query?${new URLSearchParams({ query }).toString()}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    return false;
  }

  const payload = (await response.json()) as PrometheusQueryResponse;
  const value = payload.data?.result?.[0]?.value?.[1];
  if (value === undefined) {
    return false;
  }

  const count = Number.parseFloat(value);
  return Number.isFinite(count) && count > 0;
}

function buildGraphDbMetricCountQuery(
  graphIriRaw: string,
  compoundMetric: string,
  nowMs = Date.now(),
): string {
  const graphIri = graphIriForSparqlAngleBrackets(graphIriRaw);
  const metricIri = `<http://5g4data.eu/5g4data#${compoundMetric}>`;
  const lookbackFloor = new Date(earliestObservationLookbackMs(nowMs))
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  return `
PREFIX met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT (COUNT(?obs) AS ?count)
WHERE {
  GRAPH <${graphIri}> {
    ?obs a met:Observation ;
         met:observedMetric ${metricIri} ;
         met:obtainedAt ?obtainedAt .
    FILTER (?obtainedAt >= "${lookbackFloor}"^^xsd:dateTime)
  }
}
`.trim();
}

async function graphDbMetricHasObservations(input: {
  repositoryId: string;
  graphIri: string;
  compoundMetric: string;
}): Promise<boolean> {
  let query: string;
  try {
    query = buildGraphDbMetricCountQuery(input.graphIri, input.compoundMetric);
  } catch {
    return false;
  }

  try {
    const bindings = await runRepositorySparqlSelect({
      repositoryId: input.repositoryId,
      query,
    });
    const raw = bindings[0]?.count?.value;
    const count = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count > 0;
  } catch {
    return false;
  }
}

async function countReadyMetrics(input: {
  intentId: string;
  storage: ObservationStorageType;
  repositoryId: string | null;
  graphIri: string | null;
  expectedMetrics: string[];
  prometheusBaseUrl?: string | null;
}): Promise<number> {
  if (input.expectedMetrics.length === 0) {
    return 0;
  }

  if (input.storage === "prometheus") {
    if (!(await getPrometheusConnectionStatus(input.prometheusBaseUrl))) {
      return 0;
    }

    let ready = 0;
    for (const metric of input.expectedMetrics) {
      if (await prometheusMetricHasSamples(input.intentId, metric, input.prometheusBaseUrl)) {
        ready += 1;
      }
    }
    return ready;
  }

  if (!input.repositoryId?.trim() || !input.graphIri?.trim()) {
    return 0;
  }

  let ready = 0;
  for (const metric of input.expectedMetrics) {
    if (
      await graphDbMetricHasObservations({
        repositoryId: input.repositoryId,
        graphIri: input.graphIri,
        compoundMetric: metric,
      })
    ) {
      ready += 1;
    }
  }
  return ready;
}

export async function assessIntentDataReadiness(input: {
  intentId: string;
  storage: ObservationStorageType;
  repositoryId: string | null;
  graphIri: string | null;
  compoundMetrics: string[];
  metricMetadata: MetricQueryMetadata[];
  prometheusBaseUrl?: string | null;
}): Promise<IntentDataReadiness> {
  const expectedMetrics = metricsExpectedForStorage(
    input.storage,
    input.compoundMetrics,
    input.metricMetadata,
  );
  const metricsTotal = expectedMetrics.length;

  const metricsReady = await countReadyMetrics({
    intentId: input.intentId,
    storage: input.storage,
    repositoryId: input.repositoryId,
    graphIri: input.graphIri,
    expectedMetrics,
    prometheusBaseUrl: input.prometheusBaseUrl,
  });

  const status: IntentDataStatus =
    metricsTotal > 0 && metricsReady === metricsTotal ? "ready" : "pending";

  let bounds: ObservationTimeBounds | null = null;
  if (status === "ready") {
    if (input.storage === "prometheus") {
      bounds = await fetchPrometheusObservationBounds(
        input.intentId,
        input.prometheusBaseUrl,
      );
    } else if (input.repositoryId && input.graphIri) {
      bounds = await fetchGraphDbObservationBounds({
        repositoryId: input.repositoryId,
        graphIri: input.graphIri,
        compoundMetrics: expectedMetrics,
      });
    }
  }

  return {
    status,
    metricsReady,
    metricsTotal,
    bounds,
  };
}
