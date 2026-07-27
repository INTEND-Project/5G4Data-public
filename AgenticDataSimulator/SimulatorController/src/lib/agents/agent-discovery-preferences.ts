import type { DiscoveryRole } from "@/lib/registry/agent-discovery-roles";

export const AGENT_DISCOVERY_PREFERENCES_STORAGE_KEY =
  "simulator.agentDiscoveryPreferences.v1";

/** Preferred agent name per domain, per discovery role. */
export type AgentDiscoveryPreferencesMap = Record<
  string,
  Partial<Record<DiscoveryRole, string>>
>;

export function parseAgentDiscoveryPreferencesMap(
  raw: string | null,
): AgentDiscoveryPreferencesMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: AgentDiscoveryPreferencesMap = {};
    for (const [domain, roles] of Object.entries(parsed)) {
      if (typeof domain !== "string" || !domain.trim()) continue;
      if (!roles || typeof roles !== "object" || Array.isArray(roles)) continue;
      const entry: Partial<Record<DiscoveryRole, string>> = {};
      for (const [role, name] of Object.entries(roles)) {
        if (role !== "intent-agent" && role !== "observation-agent") continue;
        if (typeof name === "string" && name.trim()) {
          entry[role] = name.trim();
        }
      }
      if (Object.keys(entry).length > 0) result[domain] = entry;
    }
    return result;
  } catch {
    return {};
  }
}

export function readAgentDiscoveryPreferencesFromStorage(): AgentDiscoveryPreferencesMap {
  if (typeof window === "undefined") return {};
  return parseAgentDiscoveryPreferencesMap(
    window.localStorage.getItem(AGENT_DISCOVERY_PREFERENCES_STORAGE_KEY),
  );
}

export function writeAgentDiscoveryPreferencesToStorage(
  map: AgentDiscoveryPreferencesMap,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    AGENT_DISCOVERY_PREFERENCES_STORAGE_KEY,
    JSON.stringify(map),
  );
}

export function getPreferredAgentName(
  map: AgentDiscoveryPreferencesMap,
  domain: string,
  role: DiscoveryRole,
): string | undefined {
  return map[domain]?.[role];
}

/** Returns a new map with the preference set (agentName) or cleared (null). */
export function setPreferredAgent(
  map: AgentDiscoveryPreferencesMap,
  domain: string,
  role: DiscoveryRole,
  agentName: string | null,
): AgentDiscoveryPreferencesMap {
  const next: AgentDiscoveryPreferencesMap = { ...map };
  const roles = { ...(next[domain] ?? {}) };

  if (agentName === null) {
    delete roles[role];
  } else {
    roles[role] = agentName;
  }

  if (Object.keys(roles).length > 0) {
    next[domain] = roles;
  } else {
    delete next[domain];
  }
  return next;
}
