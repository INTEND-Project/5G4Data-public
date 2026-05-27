import { buildIntentGrafanaUrl } from "@/lib/grafana/intent-dashboard-url";
import {
  fetchCompoundMetricsForIntent,
  fetchGraphDbObservationBounds,
  fetchPrometheusObservationBounds,
} from "@/lib/intents/observation-time-bounds";
import { resolveIntentStorage } from "@/lib/intents/resolve-intent-storage";
import { fetchIntentTurtle, listIntentIdsFromGraph } from "@/lib/kg/fetch-intent-turtle";
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
}): Promise<IntentListEntry> {
  const { intentId, owner, prometheusSet, mode } = input;
  const hasGraphTarget = Boolean(owner?.repositoryId && owner.graphIri);

  let intentTurtle: string | null = null;
  let compoundMetrics: string[] = [];

  if (hasGraphTarget && owner) {
    if (mode === "full") {
      intentTurtle = await fetchIntentTurtle({
        repositoryId: owner.repositoryId,
        graphIri: owner.graphIri,
        intentId,
      });
    }

    compoundMetrics = await fetchCompoundMetricsForIntent({
      repositoryId: owner.repositoryId,
      graphIri: owner.graphIri,
      intentId,
    });
  }

  const storage = resolveIntentStorage({
    intentTurtle,
    inPrometheus: prometheusSet.has(intentId),
  });

  const bounds =
    storage === "prometheus"
      ? await fetchPrometheusObservationBounds(intentId)
      : hasGraphTarget && owner
        ? await fetchGraphDbObservationBounds({
            repositoryId: owner.repositoryId,
            graphIri: owner.graphIri,
            compoundMetrics,
          })
        : null;

  return {
    intentId,
    storage,
    grafanaUrl: buildIntentGrafanaUrl({
      intentId,
      conditionMetrics: compoundMetrics,
      bounds,
      repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
      graphIri: hasGraphTarget && owner ? owner.graphIri : null,
    }),
    repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
    graphIri: hasGraphTarget && owner ? owner.graphIri : null,
  };
}

export async function listIntentsForDomain(
  targets: IntentTargetRef[],
  options: ListIntentsOptions = {},
): Promise<IntentListEntry[]> {
  const mode = options.mode ?? "full";

  if (mode === "lite" && options.cacheKey) {
    const cached = liteListCache.get(options.cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.intents;
    }
  }

  const intentOwners = new Map<string, IntentTargetRef>();
  const prometheusIntentIds = await listPrometheusIntentIds();
  const prometheusSet = new Set(prometheusIntentIds);

  const targetIntentIdLists = await Promise.all(
    targets.map(async (target) => ({
      target,
      ids: await listIntentIdsFromGraph(target),
    })),
  );

  for (const { target, ids } of targetIntentIdLists) {
    for (const intentId of ids) {
      if (!intentOwners.has(intentId)) {
        intentOwners.set(intentId, target);
      }
    }
  }

  for (const intentId of prometheusIntentIds) {
    if (!intentOwners.has(intentId)) {
      intentOwners.set(intentId, { repositoryId: "", graphIri: "" });
    }
  }

  const intentIds = [...intentOwners.keys()].sort((left, right) => left.localeCompare(right));

  const entries = await mapWithConcurrency(intentIds, INTENT_ENRICH_CONCURRENCY, (intentId) =>
    enrichIntentEntry({
      intentId,
      owner: intentOwners.get(intentId),
      prometheusSet,
      mode,
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
