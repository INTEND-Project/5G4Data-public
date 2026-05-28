import { buildIntentGrafanaUrl } from "@/lib/grafana/intent-dashboard-url";
import {
  fetchCompoundMetricsForIntent,
  resolveObservationTimeBounds,
} from "@/lib/intents/observation-time-bounds";
import {
  fetchMetricQueryMetadata,
  resolveObservationStorageFromMetadata,
  type MetricQueryMetadata,
} from "@/lib/kg/metric-query-metadata";
import { listIntentIdsFromGraph } from "@/lib/kg/fetch-intent-turtle";
import type { ObservationStorageType } from "@/lib/observation-storage";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import { listIntentIds } from "@/lib/prometheus/client";

export type IntentTargetRef = {
  repositoryId: string;
  graphIri: string;
};

export type IntentListEntry = {
  intentId: string;
  storage: ObservationStorageType;
  grafanaUrl: string | null;
  repositoryId: string | null;
  graphIri: string | null;
};

export type ListIntentsMode = "lite" | "full";

export type ListIntentsOptions = {
  mode?: ListIntentsMode;
  cacheKey?: string;
  ownedIntentIds?: string[];
  /** Controller username — used for Grafana JWT auto-login on dashboard links. */
  grafanaLoginUsername?: string | null;
};

const LITE_LIST_CACHE_TTL_MS = 15_000;
const INTENT_ENRICH_CONCURRENCY = 5;

type LiteListCacheEntry = {
  expiresAt: number;
  intents: IntentListEntry[];
};

const liteListCache = new Map<string, LiteListCacheEntry>();

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
}): Promise<IntentListEntry> {
  const { intentId, owner, prometheusSet, mode, grafanaLoginUsername } = input;
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

  const bounds = await resolveObservationTimeBounds({
    intentId,
    repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
    graphIri: hasGraphTarget && owner ? owner.graphIri : null,
    compoundMetrics,
    metricMetadata,
  });

  return {
    intentId,
    storage,
    grafanaUrl: buildIntentGrafanaUrl({
      intentId,
      conditionMetrics: compoundMetrics,
      bounds,
      repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
      graphIri: hasGraphTarget && owner ? owner.graphIri : null,
      loginUsername: grafanaLoginUsername,
    }),
    repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
    graphIri: hasGraphTarget && owner ? owner.graphIri : null,
  };
}

async function resolveIntentOwners(
  targets: IntentTargetRef[],
  intentIds: string[],
): Promise<Map<string, IntentTargetRef>> {
  const intentOwners = new Map<string, IntentTargetRef>();

  if (targets.length === 0 || intentIds.length === 0) {
    return intentOwners;
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
      if (ownedSet.has(intentId) && !intentOwners.has(intentId)) {
        intentOwners.set(intentId, target);
      }
    }
  }

  for (const intentId of intentIds) {
    if (!intentOwners.has(intentId)) {
      intentOwners.set(intentId, { repositoryId: "", graphIri: "" });
    }
  }

  return intentOwners;
}

export async function listIntentsForDomain(
  targets: IntentTargetRef[],
  options: ListIntentsOptions = {},
): Promise<IntentListEntry[]> {
  const mode = options.mode ?? "full";
  const ownedIntentIds = options.ownedIntentIds ?? [];

  if (mode === "lite" && options.cacheKey) {
    const cached = liteListCache.get(options.cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.intents;
    }
  }

  if (ownedIntentIds.length === 0) {
    return [];
  }

  const prometheusIntentIds = await listPrometheusIntentIds();
  const prometheusSet = new Set(prometheusIntentIds);
  const intentOwners = await resolveIntentOwners(targets, ownedIntentIds);
  const intentIds = [...ownedIntentIds].sort((left, right) => left.localeCompare(right));

  const entries = await mapWithConcurrency(intentIds, INTENT_ENRICH_CONCURRENCY, (intentId) =>
    enrichIntentEntry({
      intentId,
      owner: intentOwners.get(intentId),
      prometheusSet,
      mode,
      grafanaLoginUsername: options.grafanaLoginUsername,
    }),
  );

  if (mode === "lite" && options.cacheKey) {
    liteListCache.set(options.cacheKey, {
      expiresAt: Date.now() + LITE_LIST_CACHE_TTL_MS,
      intents: entries,
    });
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
