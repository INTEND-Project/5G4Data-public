/** simulator.controller.v1 — carried on A2A user messages from Controller. */
export type GraphTargetBinding = {
  graphTargetId?: string;
  repositoryId: string;
  graphIri: string;
  sparqlEndpoint: string;
  repositoryBaseUrl?: string;
};

export type KgTargetForBinding = {
  id: string;
  repositoryId: string;
  graphIri: string;
  displayName?: string;
};

function normalizeGraphDbBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function buildGraphTargetBinding(
  target: KgTargetForBinding,
  graphDbBaseUrl: string,
): GraphTargetBinding {
  const base = normalizeGraphDbBaseUrl(graphDbBaseUrl);
  const repositoryId = target.repositoryId.trim();
  const graphIri = target.graphIri.trim();
  const repositoryBaseUrl = `${base}repositories/${encodeURIComponent(repositoryId)}`;
  return {
    graphTargetId: target.id,
    repositoryId,
    graphIri,
    sparqlEndpoint: `${repositoryBaseUrl}/sparql`,
    repositoryBaseUrl,
  };
}

export type PrometheusStackMode = "local" | "external";

export type SimulatorControllerMetadata = {
  controllerBindingVersion: "1";
  graphTarget?: GraphTargetBinding;
  observationStorage?: "graphdb" | "prometheus";
  createIntentStorage?: "graphdb" | "prometheus";
  prometheusBaseUrl?: string;
  prometheusStorageMode?: PrometheusStackMode;
  llmModel?: string;
  llmApiBaseUrl?: string;
  temperature?: number;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
};

export function simulatorMetadataEnvelope(opts: {
  graphTarget?: GraphTargetBinding;
  observationStorage?: "graphdb" | "prometheus";
  createIntentStorage?: "graphdb" | "prometheus";
  prometheusBaseUrl?: string;
  prometheusStorageMode?: PrometheusStackMode;
  llmModel?: string;
  llmApiBaseUrl?: string;
  temperature?: number;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
}): {
  simulator: SimulatorControllerMetadata;
} {
  const simulator: SimulatorControllerMetadata = {
    controllerBindingVersion: "1",
  };
  if (opts.graphTarget) simulator.graphTarget = opts.graphTarget;
  if (opts.observationStorage) simulator.observationStorage = opts.observationStorage;
  if (opts.createIntentStorage) simulator.createIntentStorage = opts.createIntentStorage;
  const promBase = opts.prometheusBaseUrl?.trim();
  if (promBase) {
    simulator.prometheusBaseUrl = promBase;
    if (opts.prometheusStorageMode) {
      simulator.prometheusStorageMode = opts.prometheusStorageMode;
    }
  }
  const model = opts.llmModel?.trim();
  if (model) simulator.llmModel = model;
  const llmApiBaseUrl = opts.llmApiBaseUrl?.trim().replace(/\/+$/, "");
  if (llmApiBaseUrl) simulator.llmApiBaseUrl = llmApiBaseUrl;
  if (opts.temperature !== undefined && Number.isFinite(opts.temperature)) {
    simulator.temperature = Math.min(2, Math.max(0, opts.temperature));
  }
  if (opts.reportingIntervalMinutes !== undefined && Number.isFinite(opts.reportingIntervalMinutes)) {
    simulator.reportingIntervalMinutes = Math.min(
      1440,
      Math.max(1, Math.round(opts.reportingIntervalMinutes)),
    );
  }
  if (opts.reportingIntervalSeconds !== undefined && Number.isFinite(opts.reportingIntervalSeconds)) {
    simulator.reportingIntervalSeconds = Math.min(
      86_400,
      Math.max(1, Math.round(opts.reportingIntervalSeconds)),
    );
  }
  return { simulator };
}

export function hasSimulatorMetadataFields(opts: {
  graphTarget?: GraphTargetBinding;
  observationStorage?: "graphdb" | "prometheus";
  createIntentStorage?: "graphdb" | "prometheus";
  prometheusBaseUrl?: string;
  prometheusStorageMode?: PrometheusStackMode;
  llmModel?: string;
  llmApiBaseUrl?: string;
  temperature?: number;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
}): boolean {
  return Boolean(
    opts.graphTarget ||
      opts.observationStorage ||
      opts.createIntentStorage ||
      opts.prometheusBaseUrl?.trim() ||
      opts.llmModel?.trim() ||
      opts.llmApiBaseUrl?.trim() ||
      (opts.temperature !== undefined && Number.isFinite(opts.temperature)) ||
      (opts.reportingIntervalMinutes !== undefined && Number.isFinite(opts.reportingIntervalMinutes)) ||
      (opts.reportingIntervalSeconds !== undefined && Number.isFinite(opts.reportingIntervalSeconds)),
  );
}
