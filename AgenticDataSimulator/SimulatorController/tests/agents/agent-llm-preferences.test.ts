import { describe, expect, it } from "vitest";

import {
  hasAgentLlmPreference,
  normalizeAgentLlmPreference,
  parseAgentLlmPreferencesMap,
  preferenceForOpenClawMetadata,
} from "@/lib/agents/agent-llm-preferences";
import { filterChatCapableOpenAiModels } from "@/lib/openai/filter-chat-models";
import {
  hasOpenClawMetadataFields,
  openClawMetadataEnvelope,
} from "@/lib/kg/graph-target-binding";

describe("agent-llm-preferences", () => {
  it("parses stored preferences map", () => {
    const map = parseAgentLlmPreferencesMap(
      JSON.stringify({
        "5g4data-intent-generating-agent": { model: "gpt-4o-mini", temperature: 0.3 },
      }),
    );
    expect(map["5g4data-intent-generating-agent"]).toEqual({
      model: "gpt-4o-mini",
      temperature: 0.3,
    });
  });

  it("maps stored preference to openclaw metadata fields", () => {
    expect(
      preferenceForOpenClawMetadata({ model: "gpt-4o", temperature: 0.5 }, true),
    ).toEqual({ llmModel: "gpt-4o", temperature: 0.5 });
    expect(preferenceForOpenClawMetadata({ model: "", temperature: 0 }, true)).toEqual({
      temperature: 0,
    });
    expect(preferenceForOpenClawMetadata({ model: "", temperature: 0 }, false)).toEqual({});
  });

  it("detects stored preferences by agent name", () => {
    const map = parseAgentLlmPreferencesMap(
      JSON.stringify({ "agent-a": { model: "gpt-4o-mini", temperature: 0 } }),
    );
    expect(hasAgentLlmPreference(map, "agent-a")).toBe(true);
    expect(hasAgentLlmPreference(map, "agent-b")).toBe(false);
  });

  it("clamps temperature on normalize", () => {
    expect(normalizeAgentLlmPreference({ model: "x", temperature: 9 }).temperature).toBe(2);
  });
});

describe("openClawMetadataEnvelope llm fields", () => {
  it("includes llmModel and temperature when set", () => {
    const envelope = openClawMetadataEnvelope({
      llmModel: "gpt-4o-mini",
      temperature: 0.2,
    });
    expect(envelope.openclaw.llmModel).toBe("gpt-4o-mini");
    expect(envelope.openclaw.temperature).toBe(0.2);
    expect(hasOpenClawMetadataFields({ llmModel: "gpt-4o-mini" })).toBe(true);
  });
});

describe("filterChatCapableOpenAiModels", () => {
  it("filters embeddings and keeps gpt models", () => {
    const models = filterChatCapableOpenAiModels([
      "text-embedding-3-small",
      "gpt-4o-mini",
      "o3-mini",
      "whisper-1",
    ]);
    expect(models).toEqual(["gpt-4o-mini", "o3-mini"]);
  });
});
