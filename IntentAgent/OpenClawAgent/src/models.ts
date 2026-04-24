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
