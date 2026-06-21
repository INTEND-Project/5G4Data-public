import { existsSync } from "node:fs";

export const DEFAULT_GRAPHDB_REPOSITORY_ID = "intents_and_intent_reports";
export const DEFAULT_GRAPHDB_INFRA_REPOSITORY_ID = "telenor-infrastructure-5g4data";
export const DEFAULT_GRAPHDB_INFRA_NAMED_GRAPH = "http://intendproject.eu/telenor/infra";

const HOST_GRAPHDB_BASE_URL = "http://127.0.0.1:7200/";
const CONTAINER_GRAPHDB_HOST = "host.docker.internal";

export function normalizeGraphDbBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return HOST_GRAPHDB_BASE_URL;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function runningInContainer(): boolean {
  if (process.env.SIMULATOR_AGENT_CONTAINER === "true") return true;
  return existsSync("/.dockerenv");
}

export function graphDbHostGateway(): string {
  return runningInContainer() ? CONTAINER_GRAPHDB_HOST : "127.0.0.1";
}

export function defaultGraphDbBaseUrl(): string {
  return `http://${graphDbHostGateway()}:7200/`;
}

/** Map host-local GraphDB URLs to the Docker host gateway when running in a container. */
export function rewriteGraphDbUrlForContainerAccess(url: string): string {
  if (!runningInContainer()) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      return url;
    }
    parsed.hostname = CONTAINER_GRAPHDB_HOST;
    return parsed.toString();
  } catch {
    return url
      .replace(/\/\/127\.0\.0\.1(?=[:/]|$)/g, `//${CONTAINER_GRAPHDB_HOST}`)
      .replace(/\/\/localhost(?=[:/]|$)/g, `//${CONTAINER_GRAPHDB_HOST}`);
  }
}

/** Clone `.env` values — always target the Docker host gateway, not container localhost. */
export function graphDbBaseUrlForCloneFromController(controllerBaseUrl: string): string {
  const normalized = normalizeGraphDbBaseUrl(controllerBaseUrl);
  try {
    const parsed = new URL(normalized);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      parsed.hostname = CONTAINER_GRAPHDB_HOST;
      return normalizeGraphDbBaseUrl(parsed.toString());
    }
    return normalized;
  } catch {
    return normalized
      .replace(/\/\/127\.0\.0\.1(?=[:/]|$)/g, `//${CONTAINER_GRAPHDB_HOST}`)
      .replace(/\/\/localhost(?=[:/]|$)/g, `//${CONTAINER_GRAPHDB_HOST}`);
  }
}

export function repositoryIdFromGraphDbEndpoint(endpoint: string): string | undefined {
  const match = endpoint.match(/\/repositories\/([^/?#]+)/i);
  const repo = match?.[1]?.trim();
  return repo || undefined;
}

export function normalizeGraphDbRepositoryEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/sparql\/?$/i, "").replace(/\/$/, "");
}

export function graphDbRepositoryEndpointFromBase(
  baseUrl: string,
  repositoryId: string = DEFAULT_GRAPHDB_REPOSITORY_ID,
): string {
  const base = normalizeGraphDbBaseUrl(baseUrl);
  const repo = encodeURIComponent(repositoryId.trim());
  return `${base}repositories/${repo}`;
}

/** @deprecated Prefer {@link graphDbRepositoryEndpointFromBase}; kept for callers expecting the old name. */
export function graphDbSparqlEndpointFromBase(
  baseUrl: string,
  repositoryId: string = DEFAULT_GRAPHDB_REPOSITORY_ID,
): string {
  return graphDbRepositoryEndpointFromBase(baseUrl, repositoryId);
}

export function resolveGraphDbEndpoint(options?: {
  endpoint?: string;
  baseUrl?: string;
  repositoryId?: string;
}): string {
  const endpoint = options?.endpoint?.trim();
  if (endpoint) {
    return rewriteGraphDbUrlForContainerAccess(normalizeGraphDbRepositoryEndpoint(endpoint));
  }

  const baseUrl = normalizeGraphDbBaseUrl(
    options?.baseUrl?.trim() || defaultGraphDbBaseUrl(),
  );
  const repositoryId =
    options?.repositoryId?.trim() ||
    DEFAULT_GRAPHDB_REPOSITORY_ID;
  return graphDbRepositoryEndpointFromBase(baseUrl, repositoryId);
}

export function resolveGraphDbInfraEndpoint(options?: {
  endpoint?: string;
  baseUrl?: string;
  repositoryId?: string;
}): string {
  const endpoint = options?.endpoint?.trim();
  if (endpoint) {
    return rewriteGraphDbUrlForContainerAccess(normalizeGraphDbRepositoryEndpoint(endpoint));
  }

  const baseUrl = normalizeGraphDbBaseUrl(
    options?.baseUrl?.trim() || defaultGraphDbBaseUrl(),
  );
  const repositoryId =
    options?.repositoryId?.trim() || DEFAULT_GRAPHDB_INFRA_REPOSITORY_ID;
  return rewriteGraphDbUrlForContainerAccess(
    graphDbRepositoryEndpointFromBase(baseUrl, repositoryId),
  );
}
