import { getGraphDbConnectionStatus } from "@/lib/graphdb/status";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import { getRegistryConnectionStatus } from "@/lib/registry/status";

export type InfraConnectionStatus = {
  registryConnected: boolean;
  graphDbConnected: boolean;
  prometheusConnected: boolean;
};

export async function getInfraConnectionStatus(): Promise<InfraConnectionStatus> {
  const [registryConnected, graphDbConnected, prometheusConnected] = await Promise.all([
    getRegistryConnectionStatus(),
    getGraphDbConnectionStatus(),
    getPrometheusConnectionStatus(),
  ]);

  return { registryConnected, graphDbConnected, prometheusConnected };
}
