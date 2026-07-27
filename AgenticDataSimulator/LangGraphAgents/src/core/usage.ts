import type { LlmCallRecord, IntentUsageSummary } from "../models.js";
import { estimateIntentCost } from "./pricing.js";

export function buildIntentUsageSummary(calls: LlmCallRecord[]): IntentUsageSummary | undefined {
  if (calls.length === 0) return undefined;
  const inputTokens = calls.reduce((sum, call) => sum + call.usage.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.usage.outputTokens, 0);
  const totalTokens = calls.reduce((sum, call) => sum + call.usage.totalTokens, 0);
  const first = calls[0];
  if (!first) return undefined;
  return {
    provider: first.provider,
    model: first.model,
    inputTokens,
    outputTokens,
    totalTokens,
    callCount: calls.length,
    calls,
    cost: estimateIntentCost(calls)
  };
}
