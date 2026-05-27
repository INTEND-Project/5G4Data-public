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

export async function listIntentsForDomain(targets: IntentTargetRef[]): Promise<IntentListEntry[]> {
  const intentOwners = new Map<string, IntentTargetRef>();
  const prometheusIntentIds = await listPrometheusIntentIds();
  const prometheusSet = new Set(prometheusIntentIds);

  for (const target of targets) {
    const ids = await listIntentIdsFromGraph(target);
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
  const entries: IntentListEntry[] = [];

  for (const intentId of intentIds) {
    const owner = intentOwners.get(intentId);
    const hasGraphTarget = Boolean(owner?.repositoryId && owner.graphIri);

    let intentTurtle: string | null = null;
    let compoundMetrics: string[] = [];

    if (hasGraphTarget && owner) {
      intentTurtle = await fetchIntentTurtle({
        repositoryId: owner.repositoryId,
        graphIri: owner.graphIri,
        intentId,
      });
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

    entries.push({
      intentId,
      storage,
      grafanaUrl: buildIntentGrafanaUrl({
        intentId,
        conditionMetrics: compoundMetrics,
        bounds,
      }),
      repositoryId: hasGraphTarget && owner ? owner.repositoryId : null,
      graphIri: hasGraphTarget && owner ? owner.graphIri : null,
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
