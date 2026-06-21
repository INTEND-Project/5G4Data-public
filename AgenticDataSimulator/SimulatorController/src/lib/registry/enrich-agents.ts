import { resolveDiscoveryRole } from "@/lib/registry/agent-discovery-roles";
import { normalizeRegistryAgents } from "@/lib/registry/normalize";
import type { RegistryAgent, RegistryAgentRecord } from "@/lib/registry/types";

export function enrichAgentsWithDiscoveryRole(
  records: RegistryAgentRecord[],
  agents: RegistryAgent[],
): RegistryAgent[] {
  const byWellKnown = new Map<string, RegistryAgentRecord>();
  for (const record of records) {
    if (record.wellKnownURI) {
      byWellKnown.set(String(record.wellKnownURI), record);
    }
  }

  const normalized = normalizeRegistryAgents(records);
  const nameByWellKnown = new Map<string, string>();
  for (const agent of normalized) {
    if (agent.wellKnownURI) {
      nameByWellKnown.set(String(agent.wellKnownURI), agent.name);
    }
  }

  return agents.map((agent) => {
    const record = agent.wellKnownURI ? byWellKnown.get(String(agent.wellKnownURI)) : undefined;
    if (!record) {
      return agent;
    }
    const normalizedName = nameByWellKnown.get(String(agent.wellKnownURI)) ?? agent.name;
    return {
      ...agent,
      discoveryRole: resolveDiscoveryRole(record, normalizedName),
    };
  });
}
