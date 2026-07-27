/** A resolved agent discovery result: where to reach it and its registry name. */
export type DiscoveredAgentBinding = {
  wellKnownURI: string;
  agentName: string;
};

export function discoveredAgentBinding(
  wellKnownURI: string,
  agentName?: string,
): DiscoveredAgentBinding {
  return {
    wellKnownURI,
    agentName: agentName?.trim() ? agentName.trim() : "unknown",
  };
}
