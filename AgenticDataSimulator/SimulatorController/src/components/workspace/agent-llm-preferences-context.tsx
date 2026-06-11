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
  type AgentLlmPreference,
  type AgentLlmPreferencesMap,
  DEFAULT_AGENT_TEMPERATURE,
  hasAgentLlmPreference,
  normalizeAgentLlmPreference,
  readAgentLlmPreferencesFromStorage,
  writeAgentLlmPreferencesToStorage,
} from "@/lib/agents/agent-llm-preferences";

type AgentLlmPreferencesContextValue = {
  getPreference: (agentName: string) => AgentLlmPreference;
  hasStoredPreference: (agentName: string) => boolean;
  setPreference: (agentName: string, preference: AgentLlmPreference) => void;
};

const AgentLlmPreferencesContext = createContext<AgentLlmPreferencesContextValue | null>(
  null,
);

export function AgentLlmPreferencesProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<AgentLlmPreferencesMap>({});

  useEffect(() => {
    setMap(readAgentLlmPreferencesFromStorage());
  }, []);

  const persist = useCallback((next: AgentLlmPreferencesMap) => {
    setMap(next);
    writeAgentLlmPreferencesToStorage(next);
  }, []);

  const getPreference = useCallback(
    (agentName: string): AgentLlmPreference => {
      const stored = map[agentName];
      if (stored) return stored;
      return { model: "", temperature: DEFAULT_AGENT_TEMPERATURE };
    },
    [map],
  );

  const hasStoredPreference = useCallback(
    (agentName: string) => hasAgentLlmPreference(map, agentName),
    [map],
  );

  const setPreference = useCallback(
    (agentName: string, preference: AgentLlmPreference) => {
      const normalized = normalizeAgentLlmPreference(preference);
      persist({
        ...map,
        [agentName]: normalized,
      });
    },
    [map, persist],
  );

  const value = useMemo(
    () => ({ getPreference, hasStoredPreference, setPreference }),
    [getPreference, hasStoredPreference, setPreference],
  );

  return (
    <AgentLlmPreferencesContext.Provider value={value}>
      {children}
    </AgentLlmPreferencesContext.Provider>
  );
}

export function useAgentLlmPreferences(agentName: string | null | undefined) {
  const context = useContext(AgentLlmPreferencesContext);
  if (!context) {
    throw new Error("useAgentLlmPreferences must be used within AgentLlmPreferencesProvider");
  }
  const preference = agentName
    ? context.getPreference(agentName)
    : { model: "", temperature: DEFAULT_AGENT_TEMPERATURE };
  const hasStored = agentName ? context.hasStoredPreference(agentName) : false;
  const setPreference = useCallback(
    (next: AgentLlmPreference) => {
      if (!agentName) return;
      context.setPreference(agentName, next);
    },
    [agentName, context],
  );
  return { preference, hasStored, setPreference };
}

export function useAgentLlmPreferencesReader() {
  const context = useContext(AgentLlmPreferencesContext);
  if (!context) {
    throw new Error("useAgentLlmPreferencesReader must be used within AgentLlmPreferencesProvider");
  }
  return context.getPreference;
}
