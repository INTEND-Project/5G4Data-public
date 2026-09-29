import { describe, expect, it } from "vitest";

import {
  normalizeAgentLlmPreference,
  preferenceForSimulatorMetadata,
} from "../../src/lib/agents/agent-llm-preferences";

describe("agent-llm-preferences provider", () => {
  it("normalizes optional provider", () => {
    expect(
      normalizeAgentLlmPreference({
        model: "claude-sonnet-4-5",
        apiBaseUrl: "https://api.anthropic.com",
        temperature: 0.5,
        provider: "anthropic",
      }),
    ).toMatchObject({
      model: "claude-sonnet-4-5",
      provider: "anthropic",
    });
  });

  it("emits llmProvider in simulator metadata mapping", () => {
    expect(
      preferenceForSimulatorMetadata(
        normalizeAgentLlmPreference({
          model: "claude-sonnet-4-5",
          apiBaseUrl: "https://api.anthropic.com",
          temperature: 0.2,
          provider: "anthropic",
        }),
        true,
      ),
    ).toEqual({
      llmModel: "claude-sonnet-4-5",
      llmApiBaseUrl: "https://api.anthropic.com",
      llmProvider: "anthropic",
      temperature: 0.2,
    });
  });

  it("omits empty model but keeps provider when stored", () => {
    expect(
      preferenceForSimulatorMetadata(
        normalizeAgentLlmPreference({
          model: "",
          apiBaseUrl: "",
          temperature: 1,
          provider: "openai",
        }),
        true,
      ),
    ).toEqual({
      llmProvider: "openai",
      temperature: 1,
    });
  });
});
