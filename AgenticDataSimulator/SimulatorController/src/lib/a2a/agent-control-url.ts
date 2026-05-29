/** Derive agent control API URL from A2A card `url` (JSON-RPC base ending in `/v1`). */
export function workloadPreviewUrlFromAgentRpcUrl(rpcUrl: string): string {
  const trimmed = rpcUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/control/workload-preview`;
  }
  return `${trimmed}/v1/control/workload-preview`;
}
