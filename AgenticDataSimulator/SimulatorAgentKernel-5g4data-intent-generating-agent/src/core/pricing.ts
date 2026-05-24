import type { IntentCostSummary, LlmCallRecord } from "../models.js";

interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const PRICING_VERSION = "v2026_04";

const MODEL_PRICING: Record<string, ModelPricing> = {
  "openai/gpt-5.3-chat-latest": { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "openai/gpt-4o-mini": { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  "anthropic/claude-3-5-sonnet-latest": { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 }
};

function normalizeModelKey(provider: "openai" | "anthropic", model: string): string {
  return `${provider}/${model}`;
}

export function estimateIntentCost(calls: LlmCallRecord[]): IntentCostSummary {
  if (calls.length === 0) {
    return {
      currency: "USD",
      pricingVersion: PRICING_VERSION,
      pricingAvailable: false
    };
  }
  let totalCost = 0;
  for (const call of calls) {
    const key = normalizeModelKey(call.provider, call.model);
    const price = MODEL_PRICING[key];
    if (!price) {
      return {
        currency: "USD",
        pricingVersion: PRICING_VERSION,
        pricingAvailable: false
      };
    }
    totalCost += (call.usage.inputTokens / 1_000_000) * price.inputPerMillionUsd;
    totalCost += (call.usage.outputTokens / 1_000_000) * price.outputPerMillionUsd;
  }
  return {
    currency: "USD",
    estimatedTotalCostUsd: Number(totalCost.toFixed(8)),
    pricingVersion: PRICING_VERSION,
    pricingAvailable: true
  };
}
