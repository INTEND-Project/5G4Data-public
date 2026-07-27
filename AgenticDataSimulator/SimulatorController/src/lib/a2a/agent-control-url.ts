import {
  observationErrorsUrl,
  observationProgressUrl,
} from "@/lib/observation-agent/control-api-base";

/** Derive agent runtime info URL from A2A card `url` (JSON-RPC base ending in `/v1`). */
export function agentInfoUrlFromAgentRpcUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/agent/info`;
  }
  return `${trimmed}/v1/agent/info`;
}

/** Derive agent control API URL from A2A card `url` (JSON-RPC base ending in `/v1`). */
export function workloadPreviewUrlFromAgentRpcUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/control/workload-preview`;
  }
  return `${trimmed}/v1/control/workload-preview`;
}

export function observationErrorsUrlFromAgentRpcUrl(
  rpcUrl: string,
  controlBaseOverride?: string | null,
): string {
  return observationErrorsUrl(rpcUrl, controlBaseOverride);
}

export function observationProgressUrlFromAgentRpcUrl(
  rpcUrl: string,
  controlBaseOverride?: string | null,
): string {
  return observationProgressUrl(rpcUrl, controlBaseOverride);
}
