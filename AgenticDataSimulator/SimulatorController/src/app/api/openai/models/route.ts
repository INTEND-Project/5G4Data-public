import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import {
  filterModelsForListing,
  parseOpenAiCompatibleModelIds,
} from "@/lib/openai/parse-models-response";
import { resolveOpenAiApiKey } from "@/lib/openai/read-api-key";

const CACHE_TTL_MS = 5 * 60 * 1000;
const OFFICIAL_OPENAI_BASE = "https://api.openai.com/v1";

type CacheEntry = {
  models: string[];
  cachedAt: number;
};

const cacheByBaseUrl = new Map<string, CacheEntry>();

function normalizeBaseUrl(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return OFFICIAL_OPENAI_BASE;
  return trimmed.replace(/\/+$/, "");
}

function isOfficialOpenAiBase(baseUrl: string): boolean {
  return baseUrl === OFFICIAL_OPENAI_BASE;
}

function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl}/models`;
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const baseUrl = normalizeBaseUrl(url.searchParams.get("baseUrl"));
  const officialOpenAiApi = isOfficialOpenAiBase(baseUrl);
  const apiKey = resolveOpenAiApiKey(process.env);

  if (officialOpenAiApi && !apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the Controller or SimulatorAgentKernel." },
      { status: 503 },
    );
  }

  const now = Date.now();
  const cached = cacheByBaseUrl.get(baseUrl);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ models: cached.models, baseUrl });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(modelsEndpoint(baseUrl), {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch models from ${baseUrl}: ${String(err)}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json(
      { error: `Models request failed (${response.status}): ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const payload = await response.json().catch(() => null);
  const models = filterModelsForListing(
    parseOpenAiCompatibleModelIds(payload),
    officialOpenAiApi,
  );
  cacheByBaseUrl.set(baseUrl, { models, cachedAt: now });

  return NextResponse.json({ models, baseUrl });
}
