import { describe, expect, it } from "vitest";

describe("assistant draft context", () => {
  it("includes available metric names, stage, and configured model", async () => {
    const assistantModule = await import("../../src/lib/assistant/build-draft-context");

    const context = assistantModule.buildDraftContext({
      selectedDomain: "telenor.5g4data",
      availableAgents: [
        "5g4data-intent-generation-agent",
        "5g4data-observation-generation-agent",
      ],
      metricNames: ["bandwidth", "detection-latency"],
      stage: "reporting",
      assistantModel: "gpt-4.1-mini",
    });

    expect(context).toEqual({
      selectedDomain: "telenor.5g4data",
      availableAgents: [
        "5g4data-intent-generation-agent",
        "5g4data-observation-generation-agent",
      ],
      metricNames: ["bandwidth", "detection-latency"],
      stage: "reporting",
      assistantModel: "gpt-4.1-mini",
      promptHints: [
        "Use derived metric names such as bandwidth, detection-latency.",
        "Generate snippets that match the reporting stage of the script.",
      ],
    });
  });
});
