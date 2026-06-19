import {
  clampReportingIntervalMinutes,
  clampReportingIntervalSeconds,
  clampTemperature,
} from "../config.js";
import {
  graphDbHostGateway,
  normalizeGraphDbBaseUrl,
  normalizeGraphDbRepositoryEndpoint,
  repositoryIdFromGraphDbEndpoint,
  rewriteGraphDbUrlForContainerAccess,
} from "../graphdb-url.js";

/** openclaw.controller.v1 — parsed from A2A message.metadata.openclaw */

export type GraphTargetBinding = {
  graphTargetId?: string;
  repositoryId: string;
  graphIri: string;
  sparqlEndpoint: string;
  repositoryBaseUrl?: string;
};

export type GraphDbEnvFallback = {
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export type ObservationStorageType = "graphdb" | "prometheus";

function parseStorageField(value: unknown): ObservationStorageType | null {
  const t = readNonEmptyString(value)?.toLowerCase();
  if (t === "graphdb" || t === "prometheus") return t;
  return null;
}

function parsePrometheusStorageModeField(value: unknown): PrometheusStackMode | null {
  const t = readNonEmptyString(value)?.toLowerCase();
  if (t === "local" || t === "external") return t;
  return null;
}

export type PrometheusStackMode = "local" | "external";

export type OpenClawControllerMetadata = {
  graphTarget: GraphTargetBinding | null;
  observationStorage: ObservationStorageType | null;
  createIntentStorage: ObservationStorageType | null;
  prometheusBaseUrl: string | null;
  prometheusStorageMode: PrometheusStackMode | null;
  llmModel: string | null;
  temperature: number | null;
  reportingIntervalMinutes: number | null;
  reportingIntervalSeconds: number | null;
};

function parseTemperatureField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampTemperature(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return clampTemperature(parsed);
  }
  return null;
}

function parseReportingIntervalMinutesField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampReportingIntervalMinutes(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return clampReportingIntervalMinutes(parsed);
  }
  return null;
}

function parseReportingIntervalSecondsField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampReportingIntervalSeconds(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return clampReportingIntervalSeconds(parsed);
  }
  return null;
}

export function parseOpenClawControllerMetadata(metadata: unknown): OpenClawControllerMetadata | null {
  if (!isRecord(metadata)) return null;
  const openclaw = metadata.openclaw;
  if (!isRecord(openclaw)) return null;

  const version = readNonEmptyString(openclaw.controllerBindingVersion);
  if (version && version !== "1") {
    console.warn(
      `[openclaw] Ignoring metadata with unsupported controllerBindingVersion=${version}`,
    );
    return null;
  }

  let graphTarget: GraphTargetBinding | null = null;
  const raw = openclaw.graphTarget;
  if (isRecord(raw)) {
    const repositoryId = readNonEmptyString(raw.repositoryId);
    const graphIri = readNonEmptyString(raw.graphIri);
    const sparqlEndpoint = readNonEmptyString(raw.sparqlEndpoint);
    if (repositoryId && graphIri && sparqlEndpoint) {
      const repositoryBaseUrl = readNonEmptyString(raw.repositoryBaseUrl);
      graphTarget = {
        graphTargetId: readNonEmptyString(raw.graphTargetId) ?? undefined,
        repositoryId,
        graphIri,
        sparqlEndpoint: rewriteGraphDbUrlForContainerAccess(sparqlEndpoint),
        repositoryBaseUrl: repositoryBaseUrl
          ? rewriteGraphDbUrlForContainerAccess(repositoryBaseUrl)
          : undefined,
      };
    }
  }

  const observationStorage = parseStorageField(openclaw.observationStorage);
  const createIntentStorage = parseStorageField(openclaw.createIntentStorage);
  const prometheusBaseUrl = readNonEmptyString(openclaw.prometheusBaseUrl);
  const prometheusStorageMode = parsePrometheusStorageModeField(openclaw.prometheusStorageMode);
  const llmModel = readNonEmptyString(openclaw.llmModel);
  const temperature = parseTemperatureField(openclaw.temperature);
  const reportingIntervalMinutes = parseReportingIntervalMinutesField(
    openclaw.reportingIntervalMinutes
  );
  const reportingIntervalSeconds = parseReportingIntervalSecondsField(
    openclaw.reportingIntervalSeconds
  );

  if (
    !graphTarget &&
    !observationStorage &&
    !createIntentStorage &&
    !prometheusBaseUrl &&
    !llmModel &&
    temperature === null &&
    reportingIntervalMinutes === null &&
    reportingIntervalSeconds === null
  ) {
    return null;
  }

  return {
    graphTarget,
    observationStorage,
    createIntentStorage,
    prometheusBaseUrl,
    prometheusStorageMode,
    llmModel,
    temperature,
    reportingIntervalMinutes,
    reportingIntervalSeconds
  };
}

export function parseGraphTargetBindingFromMetadata(metadata: unknown): GraphTargetBinding | null {
  return parseOpenClawControllerMetadata(metadata)?.graphTarget ?? null;
}

export function bindingsConflict(
  existing: GraphTargetBinding | null | undefined,
  incoming: GraphTargetBinding,
): boolean {
  if (!existing) return false;
  return (
    existing.repositoryId !== incoming.repositoryId ||
    existing.graphIri !== incoming.graphIri ||
    existing.sparqlEndpoint !== incoming.sparqlEndpoint
  );
}

function graphDbBaseUrlFromEnv(): string {
  const configuredBase = process.env.GRAPHDB_BASE_URL?.trim();
  if (configuredBase) {
    return normalizeGraphDbBaseUrl(configuredBase);
  }
  const endpoint = process.env.GRAPHDB_ENDPOINT?.trim();
  if (endpoint) {
    const repositoryId = repositoryIdFromGraphDbEndpoint(endpoint);
    if (repositoryId) {
      const repoPath = `/repositories/${encodeURIComponent(repositoryId)}`;
      const repoBase = normalizeGraphDbRepositoryEndpoint(endpoint);
      if (repoBase.endsWith(repoPath)) {
        return normalizeGraphDbBaseUrl(repoBase.slice(0, -repoPath.length));
      }
    }
  }
  return normalizeGraphDbBaseUrl(`http://${graphDbHostGateway()}:7200/`);
}

function buildPersistTargetFromEnv(): GraphTargetBinding | null {
  const repositoryId = process.env.MISTRAL_SMALL4_GRAPH_TARGET_REPOSITORY_ID?.trim();
  const graphIri = process.env.MISTRAL_SMALL4_GRAPH_TARGET_GRAPH_IRI?.trim();
  if (!repositoryId || !graphIri) {
    return null;
  }
  const base = graphDbBaseUrlFromEnv();
  const repositoryBaseUrl = rewriteGraphDbUrlForContainerAccess(
    `${base}repositories/${encodeURIComponent(repositoryId)}`,
  );
  return {
    repositoryId,
    graphIri,
    sparqlEndpoint: `${repositoryBaseUrl}/sparql`,
    repositoryBaseUrl,
  };
}

/** Controller session binding, or clone `.env` `MISTRAL_SMALL4_GRAPH_TARGET_*` fallback for persist. */
export function resolvePersistGraphTargetBinding(
  sessionBinding?: GraphTargetBinding | null,
): GraphTargetBinding | null {
  if (sessionBinding) {
    return sessionBinding;
  }
  return buildPersistTargetFromEnv();
}
