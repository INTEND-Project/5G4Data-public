import test from "node:test";
import assert from "node:assert/strict";
import { estimateIntentCost } from "../core/pricing.js";
import { buildIntentUsageSummary } from "../core/usage.js";
import type { LlmCallRecord } from "../models.js";

test("estimateIntentCost computes openai cost", () => {
  const calls: LlmCallRecord[] = [
    {
      stage: "main_turn",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      latencyMs: 100,
      usageKnown: true
    }
  ];
  const cost = estimateIntentCost(calls);
  assert.equal(cost.pricingAvailable, true);
  assert.ok((cost.estimatedTotalCostUsd ?? 0) > 0);
});

test("buildIntentUsageSummary aggregates multiple calls", () => {
  const calls: LlmCallRecord[] = [
    {
      stage: "main_turn",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      latencyMs: 100,
      usageKnown: true
    },
    {
      stage: "repair",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      usage: { inputTokens: 500, outputTokens: 250, totalTokens: 750 },
      latencyMs: 80,
      usageKnown: true
    }
  ];
  const summary = buildIntentUsageSummary(calls);
  assert.ok(summary);
  assert.equal(summary?.inputTokens, 1500);
  assert.equal(summary?.outputTokens, 750);
  assert.equal(summary?.totalTokens, 2250);
  assert.equal(summary?.callCount, 2);
});
