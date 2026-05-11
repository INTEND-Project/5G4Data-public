import { loadAppEnv } from "@/lib/env";
import { normalizeRegistryAgents } from "@/lib/registry/normalize";
import { REGISTRY_LIST_PATHS } from "@/lib/registry/paths";
import type { RegistryAgent, RegistryAgentRecord } from "@/lib/registry/types";

const CACHE_TTL_MS = 5_000;

let cachedAgents: RegistryAgent[] | null = null;
let cachedAt = 0;

function unwrapRegistryPayload(payload: unknown): RegistryAgentRecord[] {
  if (Array.isArray(payload)) {
    return payload as RegistryAgentRecord[];
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { agents?: unknown[] }).agents)) {
    return (payload as { agents: RegistryAgentRecord[] }).agents;
  }

  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function enrichRegistryRecord(record: RegistryAgentRecord): Promise<RegistryAgentRecord> {
  if (record.domain || record.agent_card?.domain || !record.wellKnownURI) {
    return record;
  }

  try {
    const response = await fetch(record.wellKnownURI, {
      cache: "no-store",
    });

    if (!response.ok) {
      return record;
    }

    const payload = (await response.json()) as unknown;

    if (!isObject(payload)) {
      return record;
    }

    const fetchedName = typeof payload.name === "string" ? payload.name : undefined;
    const fetchedDomain = typeof payload.domain === "string" ? payload.domain : undefined;

    return {
      ...record,
      ...(record.name ? {} : fetchedName ? { name: fetchedName } : {}),
      ...(fetchedDomain ? { domain: fetchedDomain } : {}),
      agent_card:
        fetchedName || fetchedDomain
          ? {
              name: fetchedName ?? record.agent_card?.name,
              domain: fetchedDomain ?? record.agent_card?.domain,
            }
          : record.agent_card,
    };
  } catch {
    return record;
  }
}

async function fetchRegistryList(baseUrl: string) {
  for (const path of REGISTRY_LIST_PATHS) {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      continue;
    }

    const payload = (await response.json()) as unknown;
    const rawRecords = unwrapRegistryPayload(payload);
    return Promise.all(rawRecords.map((record) => enrichRegistryRecord(record)));
  }

  return [];
}

export async function listNormalizedAgents(options?: { forceRefresh?: boolean }) {
  if (
    !options?.forceRefresh &&
    cachedAgents !== null &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return cachedAgents;
  }

  const env = loadAppEnv(process.env);
  const rawAgents = await fetchRegistryList(env.a2aRegistryBaseUrl);
  const normalizedAgents = normalizeRegistryAgents(rawAgents);

  cachedAgents = normalizedAgents;
  cachedAt = Date.now();

  return normalizedAgents;
}
