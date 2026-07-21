import { describe, expect, it } from "vitest";

async function loadRegistryModule() {
  try {
    return await import("../../src/lib/registry/normalize");
  } catch (error) {
    return { error };
  }
}

describe("registry normalization", () => {
  it("normalizes mixed registry payloads and derives unique domains", async () => {
    const loaded = await loadRegistryModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    const normalized = loaded.normalizeRegistryAgents([
      {
        name: "5g4data-intent-generation-agent",
        domain: "telenor.5g4data",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/simulator-agents/5g4data-intent-generation-agent/.well-known/agent-card.json",
      },
      {
        agent_card: {
          name: "5g4data-observation-generation-agent",
          domain: "telenor.5g4data",
        },
        wellKnownURI:
          "https://start5g-1.cs.uit.no/simulator-agents/5g4data-observation-generation-agent/.well-known/agent-card.json",
      },
      {
        name: "power-reduction-status-agent",
        domain: "telenor.5gPowerReduction",
      },
    ]);

    expect(normalized).toEqual([
      {
        domain: "telenor.5g4data",
        isHealthy: null,
        name: "5g4data-intent-generation-agent",
        status: "unknown",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/simulator-agents/5g4data-intent-generation-agent/.well-known/agent-card.json",
      },
      {
        domain: "telenor.5g4data",
        isHealthy: null,
        name: "5g4data-observation-generation-agent",
        status: "unknown",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/simulator-agents/5g4data-observation-generation-agent/.well-known/agent-card.json",
      },
      {
        domain: "telenor.5gPowerReduction",
        isHealthy: null,
        name: "power-reduction-status-agent",
        status: "unknown",
        wellKnownURI: null,
      },
    ]);

    expect(loaded.deriveDomains(normalized)).toEqual([
      "telenor.5g4data",
      "telenor.5gPowerReduction",
    ]);
  });
});
