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

export type SimulatorFewShotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SimulatorControllerMetadata = {
  graphTarget: GraphTargetBinding | null;
  observationStorage: ObservationStorageType | null;
  createIntentStorage: ObservationStorageType | null;
  prometheusBaseUrl: string | null;
  prometheusStorageMode: PrometheusStackMode | null;
  llmModel: string | null;
  llmApiBaseUrl: string | null;
  /** Session override for LLM_PROVIDER (`openai` | `anthropic`). */
  llmProvider: "openai" | "anthropic" | null;
  temperature: number | null;
  reportingIntervalMinutes: number | null;
  reportingIntervalSeconds: number | null;
  observationRetentionWindow: number | null;
  intentStatusReportsEnabled: boolean | null;
  intentStatusBootstrapCompliantDelay: number | null;
  systemPrompt: string | null;
  fewShotMessages: SimulatorFewShotMessage[] | null;
  numCtx: number | null;
  stopSequences: string[] | null;
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

/** Parse `5m` / `60s` / `1h` or a bare seconds number into seconds. */
function parseDurationSecondsField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(86_400, Math.max(1, Math.round(value)));
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim().toLowerCase();
  const mSec = /^(\d+(?:\.\d+)?)s$/i.exec(s);
  if (mSec) {
    const n = Number(mSec[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(86_400, Math.max(1, Math.round(n))) : null;
  }
  const mMin = /^(\d+(?:\.\d+)?)m$/i.exec(s);
  if (mMin) {
    const n = Number(mMin[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(86_400, Math.max(1, Math.round(n * 60))) : null;
  }
  const mHour = /^(\d+(?:\.\d+)?)h$/i.exec(s);
  if (mHour) {
    const n = Number(mHour[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(86_400, Math.max(1, Math.round(n * 3600))) : null;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return Math.min(86_400, Math.max(1, Math.round(n)));
  return null;
}

function parseBooleanField(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "true" || t === "on" || t === "1" || t === "yes") return true;
    if (t === "false" || t === "off" || t === "0" || t === "no") return false;
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
  const llmProviderRaw = readNonEmptyString(simulator.llmProvider)?.toLowerCase();
  const llmProvider =
    llmProviderRaw === "openai" || llmProviderRaw === "anthropic" ? llmProviderRaw : null;
  const temperature = parseTemperatureField(simulator.temperature);
  const reportingIntervalMinutes = parseReportingIntervalMinutesField(
    simulator.reportingIntervalMinutes
  );
  const reportingIntervalSeconds = parseReportingIntervalSecondsField(
    simulator.reportingIntervalSeconds
  );
  const observationRetentionWindow = parseDurationSecondsField(
    simulator.observationRetentionWindow
  );
  const intentStatusReportsEnabled = parseBooleanField(simulator.intentStatusReportsEnabled);
  const intentStatusBootstrapCompliantDelay = parseDurationSecondsField(
    simulator.intentStatusBootstrapCompliantDelay
  );
  const systemPrompt =
    typeof simulator.systemPrompt === "string" ? simulator.systemPrompt : null;
  let fewShotMessages: SimulatorFewShotMessage[] | null = null;
  if (Array.isArray(simulator.fewShotMessages)) {
    const parsedShots: SimulatorFewShotMessage[] = [];
    for (const item of simulator.fewShotMessages) {
      if (!isRecord(item)) continue;
      const role = readNonEmptyString(item.role)?.toLowerCase();
      const content = typeof item.content === "string" ? item.content.trim() : "";
      if ((role === "user" || role === "assistant") && content) {
        parsedShots.push({ role, content });
      }
    }
    if (parsedShots.length > 0) fewShotMessages = parsedShots;
  }
  let numCtx: number | null = null;
  if (typeof simulator.numCtx === "number" && Number.isFinite(simulator.numCtx)) {
    const rounded = Math.round(simulator.numCtx);
    if (rounded >= 1) numCtx = Math.min(1_048_576, rounded);
  } else if (typeof simulator.numCtx === "string" && simulator.numCtx.trim()) {
    const parsed = Number.parseInt(simulator.numCtx.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 1) numCtx = Math.min(1_048_576, parsed);
  }
  let stopSequences: string[] | null = null;
  if (Array.isArray(simulator.stopSequences)) {
    const stops = simulator.stopSequences
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    if (stops.length > 0) stopSequences = stops;
  }

  if (
    !graphTarget &&
    !observationStorage &&
    !createIntentStorage &&
    !prometheusBaseUrl &&
    !llmModel &&
    !llmApiBaseUrl &&
    !llmProvider &&
    temperature === null &&
    reportingIntervalMinutes === null &&
    reportingIntervalSeconds === null &&
    observationRetentionWindow === null &&
    intentStatusReportsEnabled === null &&
    intentStatusBootstrapCompliantDelay === null &&
    systemPrompt === null &&
    !fewShotMessages &&
    numCtx === null &&
    !stopSequences
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
    llmProvider,
    temperature,
    reportingIntervalMinutes,
    reportingIntervalSeconds,
    observationRetentionWindow,
    intentStatusReportsEnabled,
    intentStatusBootstrapCompliantDelay,
    systemPrompt,
    fewShotMessages,
    numCtx,
    stopSequences
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
