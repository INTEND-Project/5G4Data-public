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

export type SimulatorFewShotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SimulatorControllerMetadata = {
  controllerBindingVersion: "1";
  graphTarget?: GraphTargetBinding;
  observationStorage?: "graphdb" | "prometheus";
  createIntentStorage?: "graphdb" | "prometheus";
  prometheusBaseUrl?: string;
  prometheusStorageMode?: PrometheusStackMode;
  llmModel?: string;
  llmApiBaseUrl?: string;
  llmProvider?: "openai" | "anthropic";
  temperature?: number;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
  systemPrompt?: string;
  fewShotMessages?: SimulatorFewShotMessage[];
  numCtx?: number;
  stopSequences?: string[];
};

export function simulatorMetadataEnvelope(opts: {
  graphTarget?: GraphTargetBinding;
  observationStorage?: "graphdb" | "prometheus";
  createIntentStorage?: "graphdb" | "prometheus";
  prometheusBaseUrl?: string;
  prometheusStorageMode?: PrometheusStackMode;
  llmModel?: string;
  llmApiBaseUrl?: string;
  llmProvider?: "openai" | "anthropic";
  temperature?: number;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
  systemPrompt?: string;
  fewShotMessages?: SimulatorFewShotMessage[];
  numCtx?: number;
  stopSequences?: string[];
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
  if (opts.llmProvider === "openai" || opts.llmProvider === "anthropic") {
    simulator.llmProvider = opts.llmProvider;
  }
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
  if (typeof opts.systemPrompt === "string") {
    simulator.systemPrompt = opts.systemPrompt;
  }
  if (Array.isArray(opts.fewShotMessages) && opts.fewShotMessages.length > 0) {
    simulator.fewShotMessages = opts.fewShotMessages
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0,
      )
      .map((m) => ({ role: m.role, content: m.content.trim() }));
  }
  if (opts.numCtx !== undefined && Number.isFinite(opts.numCtx)) {
    const numCtx = Math.round(opts.numCtx);
    if (numCtx >= 1) simulator.numCtx = Math.min(1_048_576, numCtx);
  }
  if (Array.isArray(opts.stopSequences) && opts.stopSequences.length > 0) {
    const stops = opts.stopSequences.map((s) => s.trim()).filter(Boolean);
    if (stops.length > 0) simulator.stopSequences = stops;
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
  llmProvider?: "openai" | "anthropic";
  temperature?: number;
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
  systemPrompt?: string;
  fewShotMessages?: SimulatorFewShotMessage[];
  numCtx?: number;
  stopSequences?: string[];
}): boolean {
  return Boolean(
    opts.graphTarget ||
      opts.observationStorage ||
      opts.createIntentStorage ||
      opts.prometheusBaseUrl?.trim() ||
      opts.llmModel?.trim() ||
      opts.llmApiBaseUrl?.trim() ||
      opts.llmProvider === "openai" ||
      opts.llmProvider === "anthropic" ||
      (opts.temperature !== undefined && Number.isFinite(opts.temperature)) ||
      (opts.reportingIntervalMinutes !== undefined && Number.isFinite(opts.reportingIntervalMinutes)) ||
      (opts.reportingIntervalSeconds !== undefined && Number.isFinite(opts.reportingIntervalSeconds)) ||
      typeof opts.systemPrompt === "string" ||
      (Array.isArray(opts.fewShotMessages) && opts.fewShotMessages.length > 0) ||
      (opts.numCtx !== undefined && Number.isFinite(opts.numCtx)) ||
      (Array.isArray(opts.stopSequences) && opts.stopSequences.some((s) => s.trim())),
  );
}
