import {
  clampReportingIntervalMinutes,
  clampReportingIntervalSeconds,
  clampTemperature,
} from "../config.js";
import { rewriteGraphDbUrlForContainerAccess } from "../graphdb-url.js";

/** simulator.controller.v1 — parsed from A2A message.metadata.simulator */

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
  graphDbInfraEndpoint: string;
  graphDbInfraNamedGraph: string;
  graphDbQueryLimit: number;
  repositoryBaseUrl?: string;
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

export type SimulatorControllerMetadata = {
  graphTarget: GraphTargetBinding | null;
  observationStorage: ObservationStorageType | null;
  createIntentStorage: ObservationStorageType | null;
  prometheusBaseUrl: string | null;
  prometheusStorageMode: PrometheusStackMode | null;
  llmModel: string | null;
  llmApiBaseUrl: string | null;
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

export function parseSimulatorControllerMetadata(metadata: unknown): SimulatorControllerMetadata | null {
  if (!isRecord(metadata)) return null;
  const simulator = metadata.simulator;
  if (!isRecord(simulator)) return null;

  const version = readNonEmptyString(simulator.controllerBindingVersion);
  if (version && version !== "1") {
    console.warn(
      `[simulator] Ignoring metadata with unsupported controllerBindingVersion=${version}`,
    );
    return null;
  }

  let graphTarget: GraphTargetBinding | null = null;
  const raw = simulator.graphTarget;
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

  const observationStorage = parseStorageField(simulator.observationStorage);
  const createIntentStorage = parseStorageField(simulator.createIntentStorage);
  const prometheusBaseUrl = readNonEmptyString(simulator.prometheusBaseUrl);
  const prometheusStorageMode = parsePrometheusStorageModeField(simulator.prometheusStorageMode);
  const llmModel = readNonEmptyString(simulator.llmModel);
  const llmApiBaseUrl = readNonEmptyString(simulator.llmApiBaseUrl)?.replace(/\/+$/, "") ?? null;
  const temperature = parseTemperatureField(simulator.temperature);
  const reportingIntervalMinutes = parseReportingIntervalMinutesField(
    simulator.reportingIntervalMinutes
  );
  const reportingIntervalSeconds = parseReportingIntervalSecondsField(
    simulator.reportingIntervalSeconds
  );

  if (
    !graphTarget &&
    !observationStorage &&
    !createIntentStorage &&
    !prometheusBaseUrl &&
    !llmModel &&
    !llmApiBaseUrl &&
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
    llmApiBaseUrl,
    temperature,
    reportingIntervalMinutes,
    reportingIntervalSeconds
  };
}

export function parseGraphTargetBindingFromMetadata(metadata: unknown): GraphTargetBinding | null {
  return parseSimulatorControllerMetadata(metadata)?.graphTarget ?? null;
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
