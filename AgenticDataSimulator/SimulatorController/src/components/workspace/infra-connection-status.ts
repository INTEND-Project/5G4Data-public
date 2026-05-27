import type { InfraConnectionStatus } from "@/lib/infra/connection-status";

export const DISCONNECTED_POLL_MS = 5_000;
/** Slow background refresh while all infra is connected (remote UIs stay responsive). */
export const CONNECTED_POLL_MS = 120_000;

export function infraPollIntervalMs(status: InfraConnectionStatus): number {
  if (!status.registryConnected || !status.graphDbConnected || !status.prometheusConnected) {
    return DISCONNECTED_POLL_MS;
  }

  return CONNECTED_POLL_MS;
}

export function registryPollIntervalMs(registryConnected: boolean): number | null {
  return registryConnected ? null : DISCONNECTED_POLL_MS;
}

export function infraStatusEquals(left: InfraConnectionStatus, right: InfraConnectionStatus): boolean {
  return (
    left.registryConnected === right.registryConnected &&
    left.graphDbConnected === right.graphDbConnected &&
    left.prometheusConnected === right.prometheusConnected
  );
}
