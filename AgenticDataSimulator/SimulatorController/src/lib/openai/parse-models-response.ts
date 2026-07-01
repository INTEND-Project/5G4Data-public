import { filterChatCapableOpenAiModels } from "@/lib/openai/filter-chat-models";

function uniqueSorted(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

/** Extract model ids from OpenAI-compatible /models JSON (OpenAI, Ollama, Open WebUI). */
export function parseOpenAiCompatibleModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const ids: string[] = [];

  const data = record.data;
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const id =
        (typeof item.id === "string" && item.id) ||
        (typeof item.name === "string" && item.name) ||
        (typeof item.model === "string" && item.model) ||
        "";
      if (id) ids.push(id);
    }
  }

  const models = record.models;
  if (Array.isArray(models)) {
    for (const entry of models) {
      if (typeof entry === "string" && entry.trim()) {
        ids.push(entry.trim());
        continue;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      const id =
        (typeof item.id === "string" && item.id) ||
        (typeof item.name === "string" && item.name) ||
        (typeof item.model === "string" && item.model) ||
        "";
      if (id) ids.push(id);
    }
  }

  return uniqueSorted(ids);
}

export function filterModelsForListing(modelIds: string[], officialOpenAiApi: boolean): string[] {
  if (!officialOpenAiApi) {
    return uniqueSorted(modelIds);
  }
  return filterChatCapableOpenAiModels(modelIds);
}
