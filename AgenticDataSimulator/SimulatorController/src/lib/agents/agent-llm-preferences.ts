import type { FewShotMessage } from "@/lib/agents/modelfile-system-prompt";

export const AGENT_LLM_PREFERENCES_STORAGE_KEY = "simulator.agentLlmPreferences.v1";

export const SPARK_LLM_API_BASE_URL = "http://spark-88e2.taile6732f.ts.net:11434/v1";
export const OPENAI_LLM_API_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_LLM_API_BASE_URL = "https://api.anthropic.com";

export const DEFAULT_LLM_API_BASE_URL_SUGGESTIONS = [
  SPARK_LLM_API_BASE_URL,
  OPENAI_LLM_API_BASE_URL,
] as const;

export const ANTHROPIC_LLM_API_BASE_URL_SUGGESTIONS = [ANTHROPIC_LLM_API_BASE_URL] as const;

export const ANTHROPIC_MODEL_SUGGESTIONS = [
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "claude-haiku-4-5",
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest",
] as const;

export type AgentLlmProvider = "openai" | "anthropic";

export type AgentLlmPreference = {
  model: string;
  /** OpenAI-compatible or Anthropic API base URL. */
  apiBaseUrl: string;
  temperature: number;
  /** Session override for LLM_PROVIDER. */
  provider?: AgentLlmProvider;
  /** Intent-generation only: observation reporting interval in minutes. */
  reportingIntervalMinutes?: number;
  /** Custom system prompt; omit to use the agent's package default. */
  systemPrompt?: string;
  /** Modelfile MESSAGE few-shots; omit/empty when unused. */
  fewShotMessages?: FewShotMessage[];
  /** Ollama context window; omit = provider/model default. */
  numCtx?: number;
  /** Chat completion stop sequences; omit/empty = none sent. */
  stopSequences?: string[];
};

export function normalizeLlmApiBaseUrl(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

export function normalizeLlmProvider(
  value: string | null | undefined,
): AgentLlmProvider | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "openai" || normalized === "anthropic") return normalized;
  return undefined;
}

export function llmApiBaseUrlSuggestions(
  runtimeDefault?: string,
  provider?: AgentLlmProvider,
): string[] {
  const suggestions: string[] =
    provider === "anthropic"
      ? [...ANTHROPIC_LLM_API_BASE_URL_SUGGESTIONS]
      : [...DEFAULT_LLM_API_BASE_URL_SUGGESTIONS];
  const normalizedRuntime = normalizeLlmApiBaseUrl(runtimeDefault);
  if (normalizedRuntime && !suggestions.includes(normalizedRuntime)) {
    suggestions.push(normalizedRuntime);
  }
  return suggestions;
}

export type AgentLlmPreferencesMap = Record<string, AgentLlmPreference>;

export const DEFAULT_AGENT_TEMPERATURE = 1;
export const DEFAULT_REPORTING_INTERVAL_MINUTES = 10;

export const STOP_SEQUENCES_HELP_TEXT = `Stop sequences end generation when the model emits any listed string. They are model- and chat-template-dependent: wrong stops can truncate early or never fire.

Examples:
• Llama 3: <|eot_id|> (often also header markers such as <|start_header_id|> / <|end_header_id|> depending on template)
• Gemma: <end_of_turn>
• Mistral-style Instruct: </s> / [INST] patterns depending on the chat template

Ollama Modelfiles may list several PARAMETER stop lines; pasting a Modelfile into the system prompt fills this list on Save.`;

export function clampAgentTemperature(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

export function clampReportingIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REPORTING_INTERVAL_MINUTES;
  return Math.min(1440, Math.max(1, Math.round(value)));
}

export function clampNumCtx(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1) return undefined;
  return Math.min(1_048_576, rounded);
}

export function normalizeStopSequences(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeFewShotMessages(input: unknown): FewShotMessage[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: FewShotMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({ role, content: content.trim() });
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeAgentLlmPreference(
  input: Partial<AgentLlmPreference> | null | undefined,
): AgentLlmPreference {
  const model = typeof input?.model === "string" ? input.model.trim() : "";
  const apiBaseUrl = normalizeLlmApiBaseUrl(input?.apiBaseUrl);
  const temperature = clampAgentTemperature(
    typeof input?.temperature === "number" ? input.temperature : DEFAULT_AGENT_TEMPERATURE,
  );
  const out: AgentLlmPreference = { model, apiBaseUrl, temperature };
  const provider = normalizeLlmProvider(input?.provider);
  if (provider) out.provider = provider;
  if (typeof input?.reportingIntervalMinutes === "number") {
    out.reportingIntervalMinutes = clampReportingIntervalMinutes(input.reportingIntervalMinutes);
  }
  if (typeof input?.systemPrompt === "string") {
    out.systemPrompt = input.systemPrompt;
  }
  const fewShots = normalizeFewShotMessages(input?.fewShotMessages);
  if (fewShots) out.fewShotMessages = fewShots;
  if (typeof input?.numCtx === "number") {
    const numCtx = clampNumCtx(input.numCtx);
    if (numCtx !== undefined) out.numCtx = numCtx;
  }
  const stops = normalizeStopSequences(input?.stopSequences);
  if (stops) out.stopSequences = stops;
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

export function preferenceForSimulatorMetadata(
  pref: AgentLlmPreference | undefined,
  stored: boolean,
): {
  llmModel?: string;
  llmApiBaseUrl?: string;
  llmProvider?: AgentLlmProvider;
  temperature?: number;
  reportingIntervalMinutes?: number;
  systemPrompt?: string;
  fewShotMessages?: FewShotMessage[];
  numCtx?: number;
  stopSequences?: string[];
} {
  if (!stored || !pref) return {};
  const out: {
    llmModel?: string;
    llmApiBaseUrl?: string;
    llmProvider?: AgentLlmProvider;
    temperature?: number;
    reportingIntervalMinutes?: number;
    systemPrompt?: string;
    fewShotMessages?: FewShotMessage[];
    numCtx?: number;
    stopSequences?: string[];
  } = {
    temperature: pref.temperature,
  };
  if (pref.model) out.llmModel = pref.model;
  if (pref.apiBaseUrl) out.llmApiBaseUrl = pref.apiBaseUrl;
  if (pref.provider) out.llmProvider = pref.provider;
  if (typeof pref.reportingIntervalMinutes === "number") {
    out.reportingIntervalMinutes = pref.reportingIntervalMinutes;
  }
  if (typeof pref.systemPrompt === "string") {
    out.systemPrompt = pref.systemPrompt;
  }
  if (pref.fewShotMessages?.length) {
    out.fewShotMessages = pref.fewShotMessages;
  }
  if (typeof pref.numCtx === "number") {
    out.numCtx = pref.numCtx;
  }
  if (pref.stopSequences?.length) {
    out.stopSequences = pref.stopSequences;
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
