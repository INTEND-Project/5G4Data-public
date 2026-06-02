import { buildIntentGrafanaUrl } from "@/lib/grafana/intent-dashboard-url";
import { assessIntentDataReadiness, type IntentDataStatus } from "@/lib/intents/intent-data-readiness";
import { fetchCompoundMetricsForIntent } from "@/lib/intents/observation-time-bounds";
import {
  fetchMetricQueryMetadata,
  resolveObservationStorageFromMetadata,
  type MetricQueryMetadata,
} from "@/lib/kg/metric-query-metadata";
import { listIntentIdsFromGraph } from "@/lib/kg/fetch-intent-turtle";
import type { ObservationStorageType } from "@/lib/observation-storage";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import {
  getLiteListCacheEntry,
  setLiteListCacheEntry,
} from "@/lib/intents/list-intents-cache";
import { listIntentIds } from "@/lib/prometheus/client";

export type IntentTargetRef = {
  repositoryId: string;
  graphIri: string;
};

export type IntentListEntry = {
  intentId: string;
  storage: ObservationStorageType;
  /** Present only when all expected observation metrics are stored and Grafana can use historic bounds. */
  grafanaUrl: string | null;
  repositoryId: string | null;
  graphIri: string | null;
  dataStatus: IntentDataStatus;
  metricsReady: number;
  metricsTotal: number;
};

export type ListIntentsMode = "lite" | "full";

export type ListIntentsOptions = {
  mode?: ListIntentsMode;
  cacheKey?: string;
  ownedIntentIds?: string[];
  /** Controller username — used for Grafana JWT auto-login on dashboard links. */
  grafanaLoginUsername?: string | null;
  /** User-selected Prometheus base URL from the workspace UI (overrides PROMETHEUS_URL). */
  prometheusBaseUrl?: string | null;
};

const INTENT_ENRICH_CONCURRENCY = 5;

export { invalidateLiteListCache } from "@/lib/intents/list-intents-cache";

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function listPrometheusIntentIds(): Promise<string[]> {
  const connected = await getPrometheusConnectionStatus();
  if (!connected) {
    return [];
  }

  try {
    return await listIntentIds();
  } catch {
    return [];
  }
}

async function enrichIntentEntry(input: {
  intentId: string;
  owner: IntentTargetRef | undefined;
  prometheusSet: Set<string>;
  mode: ListIntentsMode;
  grafanaLoginUsername?: string | null;
  prometheusBaseUrl?: string | null;
}): Promise<IntentListEntry> {
  const { intentId, owner, prometheusSet, mode, grafanaLoginUsername, prometheusBaseUrl } =
    input;
  const hasGraphTarget = Boolean(owner?.repositoryId && owner.graphIri);

  let compoundMetrics: string[] = [];
  let metricMetadata: MetricQueryMetadata[] = [];

  if (hasGraphTarget && owner) {
    compoundMetrics = await fetchCompoundMetricsForIntent({
      repositoryId: owner.repositoryId,
      graphIri: owner.graphIri,
      intentId,
    });

    metricMetadata = await fetchMetricQueryMetadata(owner.repositoryId, compoundMetrics);
  }

  const storage = resolveObservationStorageFromMetadata(
    metricMetadata,
    prometheusSet.has(intentId),
  );

  const readiness = await assessIntentDataReadiness({
    intentId,
    storage,
    repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
    graphIri: hasGraphTarget && owner ? owner.graphIri : null,
    compoundMetrics,
    metricMetadata,
    prometheusBaseUrl,
  });

  const repositoryId = hasGraphTarget && owner ? owner.repositoryId : null;
  const graphIri = hasGraphTarget && owner ? owner.graphIri : null;

  return {
    intentId,
    storage,
    grafanaUrl:
      readiness.status === "ready"
        ? buildIntentGrafanaUrl({
            intentId,
            conditionMetrics: compoundMetrics,
            bounds: readiness.bounds,
            repositoryId,
            graphIri,
            loginUsername: grafanaLoginUsername,
          })
        : null,
    repositoryId,
    graphIri,
    dataStatus: readiness.status,
    metricsReady: readiness.metricsReady,
    metricsTotal: readiness.metricsTotal,
  };
}

async function resolveIntentOwners(
  targets: IntentTargetRef[],
  intentIds: string[],
): Promise<{
  owners: Map<string, IntentTargetRef>;
  graphPresentIds: Set<string>;
}> {
  const intentOwners = new Map<string, IntentTargetRef>();
  const graphPresentIds = new Set<string>();

  if (targets.length === 0 || intentIds.length === 0) {
    return { owners: intentOwners, graphPresentIds };
  }

  const targetIntentIdLists = await Promise.all(
    targets.map(async (target) => ({
      target,
      ids: await listIntentIdsFromGraph(target),
    })),
  );

  const ownedSet = new Set(intentIds);

  for (const { target, ids } of targetIntentIdLists) {
    for (const intentId of ids) {
      if (ownedSet.has(intentId)) {
        graphPresentIds.add(intentId);
        if (!intentOwners.has(intentId)) {
          intentOwners.set(intentId, target);
        }
      }
    }
  }

  for (const intentId of intentIds) {
    if (!intentOwners.has(intentId)) {
      intentOwners.set(intentId, { repositoryId: "", graphIri: "" });
    }
  }

  return { owners: intentOwners, graphPresentIds };
}

export async function listIntentsForDomain(
  targets: IntentTargetRef[],
  options: ListIntentsOptions = {},
): Promise<IntentListEntry[]> {
  const mode = options.mode ?? "full";
  const ownedIntentIds = options.ownedIntentIds ?? [];

  if (mode === "lite" && options.cacheKey) {
    const cached = getLiteListCacheEntry(options.cacheKey);
    if (cached) {
      return cached.intents as IntentListEntry[];
    }
  }

  if (ownedIntentIds.length === 0) {
    return [];
  }

  const prometheusIntentIds = await listPrometheusIntentIds();
  const prometheusSet = new Set(prometheusIntentIds);
  const { owners: intentOwners, graphPresentIds } = await resolveIntentOwners(
    targets,
    ownedIntentIds,
  );
  const intentIds = [...ownedIntentIds]
    .filter((intentId) => graphPresentIds.has(intentId) || prometheusSet.has(intentId))
    .sort((left, right) => left.localeCompare(right));

  const entries = await mapWithConcurrency(intentIds, INTENT_ENRICH_CONCURRENCY, (intentId) =>
    enrichIntentEntry({
      intentId,
      owner: intentOwners.get(intentId),
      prometheusSet,
      mode,
      grafanaLoginUsername: options.grafanaLoginUsername,
      prometheusBaseUrl: options.prometheusBaseUrl,
    }),
  );

  if (mode === "lite" && options.cacheKey) {
    setLiteListCacheEntry(options.cacheKey, entries);
  }

  return entries;
}

export async function resolveIntentOwner(
  targets: IntentTargetRef[],
  intentId: string,
): Promise<IntentTargetRef | null> {
  for (const target of targets) {
    const ids = await listIntentIdsFromGraph(target);
    if (ids.includes(intentId)) {
      return target;
    }
  }

  return null;
}
