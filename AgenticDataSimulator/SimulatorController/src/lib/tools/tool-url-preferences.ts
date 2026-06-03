import type { ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";

export const TOOL_TMF_URL_PREFERENCES_STORAGE_KEY = "simulator.toolTmfBaseUrls.v1";

export type ToolTmfUrlPreferencesMap = Partial<Record<ExtraFunctionalToolId, string>>;

export function parseToolTmfUrlPreferencesMap(raw: string | null): ToolTmfUrlPreferencesMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: ToolTmfUrlPreferencesMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== "string" || !key.trim()) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      result[key as ExtraFunctionalToolId] = value.trim();
    }
    return result;
  } catch {
    return {};
  }
}

export function readToolTmfUrlPreferencesFromStorage(): ToolTmfUrlPreferencesMap {
  if (typeof window === "undefined") return {};
  return parseToolTmfUrlPreferencesMap(
    window.localStorage.getItem(TOOL_TMF_URL_PREFERENCES_STORAGE_KEY),
  );
}

export function writeToolTmfUrlPreferencesToStorage(map: ToolTmfUrlPreferencesMap): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOOL_TMF_URL_PREFERENCES_STORAGE_KEY, JSON.stringify(map));
}
