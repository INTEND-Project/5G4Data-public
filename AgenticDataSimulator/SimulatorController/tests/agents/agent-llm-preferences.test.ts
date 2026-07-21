import { describe, expect, it } from "vitest";

import {
  normalizeAgentLlmPreference,
  preferenceForSimulatorMetadata,
} from "@/lib/agents/agent-llm-preferences";
import { parseOpenAiCompatibleModelIds } from "@/lib/openai/parse-models-response";

describe("agent-llm-preferences", () => {
  it("normalizes api base URL without trailing slash", () => {
    expect(
      normalizeAgentLlmPreference({
        model: "codestral:latest",
        apiBaseUrl: "http://spark:11434/v1/",
        temperature: 0.5,
      }),
    ).toEqual({
      model: "codestral:latest",
      apiBaseUrl: "http://spark:11434/v1",
      temperature: 0.5,
    });
  });

  it("maps stored preferences to simulator metadata fields", () => {
    const pref = normalizeAgentLlmPreference({
      model: "codestral:latest",
      apiBaseUrl: "http://spark:11434/v1",
      temperature: 0.8,
    });
    expect(preferenceForSimulatorMetadata(pref, true)).toEqual({
      llmModel: "codestral:latest",
      llmApiBaseUrl: "http://spark:11434/v1",
      temperature: 0.8,
    });
  });
});

describe("parseOpenAiCompatibleModelIds", () => {
  it("reads OpenAI-style data[].id entries", () => {
    expect(
      parseOpenAiCompatibleModelIds({
        data: [{ id: "gpt-4o-mini" }, { id: "codestral:latest" }],
      }),
    ).toEqual(["codestral:latest", "gpt-4o-mini"]);
  });

  it("reads Ollama-style models[].name entries", () => {
    expect(
      parseOpenAiCompatibleModelIds({
        models: [{ name: "codestral:latest" }, { name: "llama3.2:latest" }],
      }),
    ).toEqual(["codestral:latest", "llama3.2:latest"]);
  });
});
