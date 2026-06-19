import { z } from "zod";

export const roleSchema = z.enum(["user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;

export interface ChatMessage {
  role: Role;
  text: string;
  createdAt: string;
}

export interface GraphTargetBinding {
  graphTargetId?: string;
  repositoryId: string;
  graphIri: string;
  sparqlEndpoint: string;
  repositoryBaseUrl?: string;
}

export type ObservationStorageType = "graphdb" | "prometheus";

export interface IntentDraftFragment {
  id: string;
  turtle: string;
  locals: string[];
}

export interface IntentDraft {
  intentDescription: string;
  fragments: IntentDraftFragment[];
}

export interface ChatSession {
  sessionId: string;
  createdAt: string;
  messages: ChatMessage[];
  /** From first A2A message metadata.openclaw.graphTarget for this task. */
  graphTargetBinding?: GraphTargetBinding | null;
  /** Session override from `request observation-report … storage`. */
  observationStorage?: ObservationStorageType | null;
  /** From Controller `create intent … storage` for the bound intent alias. */
  createIntentStorage?: ObservationStorageType | null;
  /** From A2A metadata.openclaw.llmModel for this task. */
  llmModelOverride?: string | null;
  /** From A2A metadata.openclaw.temperature for this task. */
  temperatureOverride?: number | null;
  /** From A2A metadata.openclaw.reportingIntervalMinutes for this task. */
  reportingIntervalMinutesOverride?: number | null;
  /** From A2A metadata.openclaw.reportingIntervalSeconds for this task (takes precedence over minutes). */
  reportingIntervalSecondsOverride?: number | null;
  /** Workspace Prometheus API base from Controller UI. */
  prometheusBaseUrl?: string | null;
  /** local = Pushgateway streaming; external = remote-write only. */
  prometheusStorageMode?: "local" | "external" | null;
  /** Accumulated per-fragment Turtle during fragmented generation (confirmation turn). */
  intentDraft?: IntentDraft;
}

export type ModelInvokeOptions = {
  stage: string;
  llmModel?: string | null;
  temperature?: number | null;
};

export interface AgentTurnResult {
  response: string;
  warnings: string[];
  debug: string[];
  intentUsageSummary?: IntentUsageSummary;
  /** Per-turn UUID; also MLflow trace client_request_id when tracing is enabled. */
  turnId?: string;
  /** MLflow trace id for offline judge correlation (when tracing exported successfully). */
  mlflowTraceId?: string;
  /** Substantive user requirement used for generation (may differ from turn input on confirmation). */
  effectiveUserText?: string;
  /** Whether the final assistant response contains Turtle intent output. */
  turtlePresent?: boolean;
  /** Whether this turn acknowledged a prior confirmation prompt. */
  confirmationAck?: boolean;
  /** MLflow trace tags accumulated during the turn (for final merge in traceAgentTurn). */
  traceTags?: Record<string, string>;
  /** MLflow trace metadata accumulated during the turn. */
  traceMetadata?: Record<string, string>;
}

export interface LlmCallUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmCallRecord {
  stage: string;
  provider: "openai" | "anthropic";
  model: string;
  /** Resolved temperature from session override or config. */
  temperature: number;
  /** Whether temperature was included on the provider API request. */
  temperatureSent: boolean;
  usage: LlmCallUsage;
  latencyMs: number;
  requestId?: string;
  usageKnown: boolean;
}

export interface IntentCostSummary {
  currency: "USD";
  estimatedTotalCostUsd?: number;
  pricingVersion: string;
  pricingAvailable: boolean;
}

export interface IntentUsageSummary {
  provider: "openai" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  calls: LlmCallRecord[];
  cost: IntentCostSummary;
}

export interface ModelInvocationResult {
  text: string;
  call: LlmCallRecord;
}

export const catalogueChartSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  urls: z.array(z.string()).optional(),
  values: z.unknown().optional()
});

export const graphDbBindingSchema = z.object({
  datacenter: z.object({ value: z.string() }).optional(),
  clusterId: z.object({ value: z.string() }).optional(),
  location: z.object({ value: z.string() }).optional(),
  lat: z.object({ value: z.string() }).optional(),
  long: z.object({ value: z.string() }).optional()
});

export const graphDbResponseSchema = z.object({
  results: z
    .object({
      bindings: z.array(graphDbBindingSchema)
    })
    .default({ bindings: [] })
});
