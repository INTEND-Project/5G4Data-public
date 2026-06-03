import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth/guards";
import { filterChatCapableOpenAiModels } from "@/lib/openai/filter-chat-models";
import { resolveOpenAiApiKey } from "@/lib/openai/read-api-key";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedModels: string[] | null = null;
let cachedAt = 0;

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = resolveOpenAiApiKey(process.env);
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the Controller or SimulatorAgentKernel." },
      { status: 503 },
    );
  }

  const now = Date.now();
  if (cachedModels && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({ models: cachedModels });
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/models", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch models from OpenAI: ${String(err)}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json(
      { error: `OpenAI models request failed (${response.status}): ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  const ids = (payload.data ?? [])
    .map((entry) => (typeof entry.id === "string" ? entry.id : ""))
    .filter(Boolean);

  const models = filterChatCapableOpenAiModels(ids);
  cachedModels = models;
  cachedAt = now;

  return NextResponse.json({ models });
}
