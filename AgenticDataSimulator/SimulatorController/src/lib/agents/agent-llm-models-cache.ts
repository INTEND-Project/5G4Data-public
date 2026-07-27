import { normalizeLlmApiBaseUrl } from "@/lib/agents/agent-llm-preferences";

/** In-memory cache of discovered model lists, keyed by normalized API base URL. */
const modelsByBaseUrl = new Map<string, string[]>();

/**
 * Pick the effective base URL to fetch models from: the first non-empty of the
 * current draft, the stored preference, then the runtime default.
 */
export function resolveAgentModelsFetchBaseUrl(
  draftBaseUrl: string,
  storedBaseUrl: string,
  runtimeDefaultBaseUrl: string,
): string {
  return (
    normalizeLlmApiBaseUrl(draftBaseUrl) ||
    normalizeLlmApiBaseUrl(storedBaseUrl) ||
    normalizeLlmApiBaseUrl(runtimeDefaultBaseUrl)
  );
}

export function getCachedModelsForBaseUrl(baseUrl: string): string[] | null {
  const key = normalizeLlmApiBaseUrl(baseUrl);
  if (!key) return null;
  return modelsByBaseUrl.get(key) ?? null;
}

export function setCachedModelsForBaseUrl(baseUrl: string, models: string[]): void {
  const key = normalizeLlmApiBaseUrl(baseUrl);
  if (!key) return;
  modelsByBaseUrl.set(key, [...models]);
}
