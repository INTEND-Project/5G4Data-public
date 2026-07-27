import { getGraphDbConnectionStatus } from "@/lib/graphdb/status";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import { getRegistryConnectionStatus } from "@/lib/registry/status";
import { getWorkloadCatalogConnectionStatus } from "@/lib/workload-catalogue/status";

export type InfraConnectionStatus = {
  registryConnected: boolean;
  graphDbConnected: boolean;
  prometheusConnected: boolean;
  workloadCatalogConnected: boolean;
};

export const INFRA_STATUS_CACHE_TTL_MS = 60_000;

let cachedStatus: InfraConnectionStatus | null = null;
let cachedAt = 0;

export async function getInfraConnectionStatus(options?: {
  forceRefresh?: boolean;
  prometheusBaseUrl?: string | null;
}): Promise<InfraConnectionStatus> {
  if (
    !options?.forceRefresh &&
    cachedStatus !== null &&
    Date.now() - cachedAt < INFRA_STATUS_CACHE_TTL_MS
  ) {
    return cachedStatus;
  }

  const [registryConnected, graphDbConnected, prometheusConnected, workloadCatalogConnected] =
    await Promise.all([
      getRegistryConnectionStatus(),
      getGraphDbConnectionStatus(),
      getPrometheusConnectionStatus(options?.prometheusBaseUrl),
      getWorkloadCatalogConnectionStatus(),
    ]);

  cachedStatus = {
    registryConnected,
    graphDbConnected,
    prometheusConnected,
    workloadCatalogConnected,
  };
  cachedAt = Date.now();

  return cachedStatus;
}
