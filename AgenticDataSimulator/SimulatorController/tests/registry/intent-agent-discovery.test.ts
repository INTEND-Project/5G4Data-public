import { describe, expect, it } from "vitest";

import {
  pickIntentGeneratingAgent,
  suggestsIntentGeneration,
} from "../../src/lib/registry/intent-agent-discovery";
import type { RegistryAgentRecord } from "../../src/lib/registry/types";

const intentUri =
  "https://start5g.example/5g4data-intent-generating-agent/.well-known/agent-card.json";
const observationUri =
  "https://start5g.example/5g4data-intent-observation-generating-agent/.well-known/agent-card.json";

describe("intent agent discovery helpers", () => {
  it("detects canonical generate-intent skills", () => {
    const generating: RegistryAgentRecord = {
      name: "5g4data-intent-generating-agent",
      domain: "telenor.5g4data",
      description: "",
      skills: [{ id: "generate-intent", name: "Generate intent", tags: [], description: "" }],
      wellKnownURI: intentUri,
    };

    const observing: RegistryAgentRecord = {
      name: "5g4data-intent-observation-generating-agent",
      domain: "telenor.5g4data",
      description:
        "Controls and reports observation behavior for created 5G4Data intents.",
      skills: [
        {
          id: "observe-intent",
          name: "Observe intent",
          tags: [],
          description: "",
        },
      ],
      wellKnownURI: observationUri,
    };

    expect(suggestsIntentGeneration(generating, generating.name)).toBe(true);
    expect(suggestsIntentGeneration(observing, observing.name)).toBe(false);
  });

  it("picks generating agents over observers for the selected domain", () => {
    const records: RegistryAgentRecord[] = [
      {
        name: "5g4data-intent-observation-generating-agent",
        domain: "telenor.5g4data",
        description:
          "Controls and reports observation behavior for created 5G4Data intents.",
        skills: [
          {
            id: "observe-intent",
            name: "Observe intent",
            tags: [],
            description: "",
          },
        ],
        wellKnownURI: observationUri,
        is_healthy: true,
      },
      {
        name: "5g4data-intent-generating-agent",
        domain: "telenor.5g4data",
        description: "Generates 5G4Data intent definitions and deployment-ready payload guidance.",
        skills: [
          {
            id: "generate-intent",
            name: "Generate intent",
            tags: ["5g4data", "intent", "generation"],
            description: "",
          },
        ],
        wellKnownURI: intentUri,
        is_healthy: false,
      },
    ];

    const choice = pickIntentGeneratingAgent(records, "telenor.5g4data");

    expect(choice?.wellKnownURI).toBe(intentUri);
  });

  it("prefers the configured preferred agent even when another is healthier", () => {
    const healthyAltUri =
      "https://start5g.example/5g4data-intent-generating-agent-alt/.well-known/agent-card.json";
    const records: RegistryAgentRecord[] = [
      {
        name: "5g4data-intent-generating-agent-alt",
        domain: "telenor.5g4data",
        description: "Generates 5G4Data intent definitions and deployment-ready payload guidance.",
        skills: [{ id: "generate-intent", name: "Generate intent", tags: [], description: "" }],
        wellKnownURI: healthyAltUri,
        is_healthy: true,
      },
      {
        name: "5g4data-intent-generating-agent",
        domain: "telenor.5g4data",
        description: "Generates 5G4Data intent definitions and deployment-ready payload guidance.",
        skills: [{ id: "generate-intent", name: "Generate intent", tags: [], description: "" }],
        wellKnownURI: intentUri,
        is_healthy: false,
      },
    ];

    const choice = pickIntentGeneratingAgent(records, "telenor.5g4data", {
      preferredAgentName: "5g4data-intent-generating-agent",
    });

    expect(choice?.wellKnownURI).toBe(intentUri);
  });

  it("detects discovery-task tags before heuristics", () => {
    const tagged: RegistryAgentRecord = {
      name: "custom-intent-agent",
      domain: "telenor.5g4data",
      description: "",
      skills: [
        {
          id: "custom",
          name: "Custom",
          tags: ["discovery-task:intent-agent"],
          description: "",
        },
      ],
      wellKnownURI: intentUri,
    };

    expect(suggestsIntentGeneration(tagged, tagged.name)).toBe(true);
  });
});
