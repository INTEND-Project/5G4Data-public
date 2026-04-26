import { z } from "zod";

export const roleSchema = z.enum(["user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;

export interface ChatMessage {
  role: Role;
  text: string;
  createdAt: string;
}

export interface ChatSession {
  sessionId: string;
  createdAt: string;
  messages: ChatMessage[];
}

export interface AgentTurnResult {
  response: string;
  warnings: string[];
  debug: string[];
  intentUsageSummary?: IntentUsageSummary;
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
