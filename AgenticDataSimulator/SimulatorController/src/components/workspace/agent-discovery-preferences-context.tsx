"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  type AgentDiscoveryPreferencesMap,
  getPreferredAgentName as getPreferredFromMap,
  readAgentDiscoveryPreferencesFromStorage,
  setPreferredAgent,
  writeAgentDiscoveryPreferencesToStorage,
} from "@/lib/agents/agent-discovery-preferences";
import type { DiscoveryRole } from "@/lib/registry/agent-discovery-roles";

type AgentDiscoveryPreferencesContextValue = {
  isPreferred: (domain: string, role: DiscoveryRole, agentName: string) => boolean;
  togglePreferred: (domain: string, role: DiscoveryRole, agentName: string) => void;
  getPreferredAgentName: (domain: string, role: DiscoveryRole) => string | undefined;
};

const AgentDiscoveryPreferencesContext =
  createContext<AgentDiscoveryPreferencesContextValue | null>(null);

export function AgentDiscoveryPreferencesProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<AgentDiscoveryPreferencesMap>({});

  useEffect(() => {
    setMap(readAgentDiscoveryPreferencesFromStorage());
  }, []);

  const persist = useCallback((next: AgentDiscoveryPreferencesMap) => {
    setMap(next);
    writeAgentDiscoveryPreferencesToStorage(next);
  }, []);

  const isPreferred = useCallback(
    (domain: string, role: DiscoveryRole, agentName: string) =>
      getPreferredFromMap(map, domain, role) === agentName,
    [map],
  );

  const getPreferredAgentName = useCallback(
    (domain: string, role: DiscoveryRole) => getPreferredFromMap(map, domain, role),
    [map],
  );

  const togglePreferred = useCallback(
    (domain: string, role: DiscoveryRole, agentName: string) => {
      const current = getPreferredFromMap(map, domain, role);
      const nextName = current === agentName ? null : agentName;
      persist(setPreferredAgent(map, domain, role, nextName));
    },
    [map, persist],
  );

  const value = useMemo(
    () => ({ isPreferred, togglePreferred, getPreferredAgentName }),
    [getPreferredAgentName, isPreferred, togglePreferred],
  );

  return (
    <AgentDiscoveryPreferencesContext.Provider value={value}>
      {children}
    </AgentDiscoveryPreferencesContext.Provider>
  );
}

export function useAgentDiscoveryPreferences() {
  const context = useContext(AgentDiscoveryPreferencesContext);
  if (!context) {
    throw new Error(
      "useAgentDiscoveryPreferences must be used within AgentDiscoveryPreferencesProvider",
    );
  }
  return context;
}

export function useAgentDiscoveryPreferencesReader() {
  const context = useContext(AgentDiscoveryPreferencesContext);
  if (!context) {
    throw new Error(
      "useAgentDiscoveryPreferencesReader must be used within AgentDiscoveryPreferencesProvider",
    );
  }
  return context.getPreferredAgentName;
}
