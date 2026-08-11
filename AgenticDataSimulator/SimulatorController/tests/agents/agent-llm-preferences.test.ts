import { describe, expect, it } from "vitest";

import {
  STOP_SEQUENCES_HELP_TEXT,
  normalizeAgentLlmPreference,
  preferenceForSimulatorMetadata,
} from "../../src/lib/agents/agent-llm-preferences";

describe("agent-llm-preferences", () => {
  it("normalizes system prompt, few-shots, numCtx, and stop sequences", () => {
    const pref = normalizeAgentLlmPreference({
      model: "m",
      apiBaseUrl: "http://host/v1/",
      temperature: 0.2,
      systemPrompt: "Be precise.",
      fewShotMessages: [
        { role: "user", content: "u" },
        { role: "assistant", content: "a" },
        { role: "user", content: "  " },
      ],
      numCtx: 4096.2,
      stopSequences: ["</s>", "  ", "<|eot_id|>"],
    });
    expect(pref.apiBaseUrl).toBe("http://host/v1");
    expect(pref.systemPrompt).toBe("Be precise.");
    expect(pref.fewShotMessages).toEqual([
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ]);
    expect(pref.numCtx).toBe(4096);
    expect(pref.stopSequences).toEqual(["</s>", "<|eot_id|>"]);
  });

  it("includes custom prompt fields in simulator metadata mapping only when stored", () => {
    const pref = normalizeAgentLlmPreference({
      temperature: 0.5,
      systemPrompt: "sys",
      fewShotMessages: [{ role: "user", content: "hi" }],
      numCtx: 2048,
      stopSequences: ["</s>"],
    });
    expect(preferenceForSimulatorMetadata(pref, false)).toEqual({});
    expect(preferenceForSimulatorMetadata(pref, true)).toMatchObject({
      temperature: 0.5,
      systemPrompt: "sys",
      fewShotMessages: [{ role: "user", content: "hi" }],
      numCtx: 2048,
      stopSequences: ["</s>"],
    });
  });

  it("exposes stop sequences help copy for the settings info button", () => {
    expect(STOP_SEQUENCES_HELP_TEXT).toContain("<|eot_id|>");
    expect(STOP_SEQUENCES_HELP_TEXT).toContain("<end_of_turn>");
    expect(STOP_SEQUENCES_HELP_TEXT).toContain("</s>");
    expect(STOP_SEQUENCES_HELP_TEXT).toContain("[INST]");
  });
});
