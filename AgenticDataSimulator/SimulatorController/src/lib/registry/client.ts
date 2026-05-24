import { loadAppEnv } from "@/lib/env";
import { buildA2AAuthHeaders } from "@/lib/a2a/auth-headers";
import { normalizeRegistryAgents } from "@/lib/registry/normalize";
import { REGISTRY_LIST_PATHS } from "@/lib/registry/paths";
import type { RegistryAgent, RegistryAgentRecord } from "@/lib/registry/types";

const CACHE_TTL_MS = 5_000;

let cachedAgents: RegistryAgent[] | null = null;
let cachedRawRecords: RegistryAgentRecord[] | null = null;
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

  const env = loadAppEnv(process.env);
  const authHeaders = buildA2AAuthHeaders(env, { wellKnownUri: record.wellKnownURI });

  try {
    const response = await fetch(record.wellKnownURI, {
      cache: "no-store",
      headers: authHeaders,
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

async function loadRegistry(forceRefresh?: boolean): Promise<{
  raw: RegistryAgentRecord[];
  normalized: RegistryAgent[];
}> {
  if (
    !forceRefresh &&
    cachedAgents !== null &&
    cachedRawRecords !== null &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return { raw: cachedRawRecords, normalized: cachedAgents };
  }

  const env = loadAppEnv(process.env);
  const rawAgents = await fetchRegistryList(env.a2aRegistryBaseUrl);
  const normalizedAgents = normalizeRegistryAgents(rawAgents);

  cachedRawRecords = rawAgents;
  cachedAgents = normalizedAgents;
  cachedAt = Date.now();

  return { raw: rawAgents, normalized: normalizedAgents };
}

export async function listRegistryRecords(options?: { forceRefresh?: boolean }) {
  const { raw } = await loadRegistry(options?.forceRefresh);
  return raw;
}

export async function listNormalizedAgents(options?: { forceRefresh?: boolean }) {
  const { normalized } = await loadRegistry(options?.forceRefresh);
  return normalized;
}
