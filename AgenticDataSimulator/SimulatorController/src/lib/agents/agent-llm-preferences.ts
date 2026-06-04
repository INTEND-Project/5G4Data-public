export const AGENT_LLM_PREFERENCES_STORAGE_KEY = "simulator.agentLlmPreferences.v1";

export type AgentLlmPreference = {
  model: string;
  temperature: number;
  /** Intent-generation only: observation reporting interval in minutes. */
  reportingIntervalMinutes?: number;
};

export type AgentLlmPreferencesMap = Record<string, AgentLlmPreference>;

export const DEFAULT_AGENT_TEMPERATURE = 0;
export const DEFAULT_REPORTING_INTERVAL_MINUTES = 10;

export function clampAgentTemperature(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

export function clampReportingIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REPORTING_INTERVAL_MINUTES;
  return Math.min(1440, Math.max(1, Math.round(value)));
}

export function normalizeAgentLlmPreference(
  input: Partial<AgentLlmPreference> | null | undefined,
): AgentLlmPreference {
  const model = typeof input?.model === "string" ? input.model.trim() : "";
  const temperature = clampAgentTemperature(
    typeof input?.temperature === "number" ? input.temperature : DEFAULT_AGENT_TEMPERATURE,
  );
  const out: AgentLlmPreference = { model, temperature };
  if (typeof input?.reportingIntervalMinutes === "number") {
    out.reportingIntervalMinutes = clampReportingIntervalMinutes(input.reportingIntervalMinutes);
  }
  return out;
}

export function parseAgentLlmPreferencesMap(raw: string | null): AgentLlmPreferencesMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: AgentLlmPreferencesMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== "string" || !key.trim()) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      result[key] = normalizeAgentLlmPreference(value as Partial<AgentLlmPreference>);
    }
    return result;
  } catch {
    return {};
  }
}

export function readAgentLlmPreferencesFromStorage(): AgentLlmPreferencesMap {
  if (typeof window === "undefined") return {};
  return parseAgentLlmPreferencesMap(
    window.localStorage.getItem(AGENT_LLM_PREFERENCES_STORAGE_KEY),
  );
}

export function writeAgentLlmPreferencesToStorage(map: AgentLlmPreferencesMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AGENT_LLM_PREFERENCES_STORAGE_KEY, JSON.stringify(map));
}

export function hasAgentLlmPreference(
  map: AgentLlmPreferencesMap,
  agentName: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(map, agentName);
}

export function preferenceForOpenClawMetadata(
  pref: AgentLlmPreference | undefined,
  stored: boolean,
): { llmModel?: string; temperature?: number; reportingIntervalMinutes?: number } {
  if (!stored || !pref) return {};
  const out: { llmModel?: string; temperature?: number; reportingIntervalMinutes?: number } = {
    temperature: pref.temperature,
  };
  if (pref.model) out.llmModel = pref.model;
  if (typeof pref.reportingIntervalMinutes === "number") {
    out.reportingIntervalMinutes = pref.reportingIntervalMinutes;
  }
  return out;
}

/** True for intent authoring agents (registry names vary: generating vs generation). */
export function isIntentGenerationAgent(agentName: string): boolean {
  const lower = agentName.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("intent-generating") ||
    lower.includes("intent-generation") ||
    lower.includes("5g4data-intent-gen")
  );
}
