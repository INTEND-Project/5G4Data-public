import { loadAppEnv } from "@/lib/env";
import type { ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";
import { normalizeTmfBaseUrl } from "@/lib/tools/parse-tmf-base-url";

export function defaultTmfBaseUrlForTool(toolId: ExtraFunctionalToolId): string | undefined {
  const env = loadAppEnv(process.env);
  const raw =
    toolId === "inSustain"
      ? env.inSustainTmfBaseUrl
      : toolId === "inCoord"
        ? env.inCoordTmfBaseUrl
        : env.inExplainTmfBaseUrl;
  if (!raw?.trim()) {
    return undefined;
  }
  return normalizeTmfBaseUrl(raw);
}

export function allToolEnvDefaultUrls(): Partial<Record<ExtraFunctionalToolId, string>> {
  const out: Partial<Record<ExtraFunctionalToolId, string>> = {};
  for (const id of ["inSustain", "inCoord", "inExplain"] as const) {
    const url = defaultTmfBaseUrlForTool(id);
    if (url) {
      out[id] = url;
    }
  }
  return out;
}
