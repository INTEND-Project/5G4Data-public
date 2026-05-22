import { describe, expect, it } from "vitest";

import { suggestsIntentGeneration } from "../../src/lib/registry/intent-agent-discovery";
import {
  pickObservationControlAgent,
  suggestsObservationControl,
} from "../../src/lib/registry/observation-agent-discovery";
import type { RegistryAgentRecord } from "../../src/lib/registry/types";

const intentUri =
  "https://start5g.example/5g4data-intent-generating-agent/.well-known/agent-card.json";
const observationUri =
  "https://start5g.example/5g4data-intent-observation-generating-agent/.well-known/agent-card.json";

describe("observation agent discovery helpers", () => {
  it("detects observe-intent skill and excludes intent-generating agents", () => {
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

    expect(suggestsIntentGeneration(observing, observing.name)).toBe(false);
    expect(suggestsObservationControl(observing, observing.name)).toBe(true);
    expect(suggestsObservationControl(generating, generating.name)).toBe(false);
  });

  it("picks observation controller over intent generator for the selected domain", () => {
    const records: RegistryAgentRecord[] = [
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
        is_healthy: true,
      },
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
    ];

    const choice = pickObservationControlAgent(records, "telenor.5g4data");

    expect(choice?.wellKnownURI).toBe(observationUri);
  });

  it("prefers healthier observation agents when both qualify", () => {
    const healthy: RegistryAgentRecord = {
      name: "5g4data-intent-observation-generating-agent",
      domain: "telenor.5g4data",
      description: "Controls and reports observation behavior for created 5G4Data intents.",
      skills: [{ id: "observe-intent", name: "Observe intent", tags: [], description: "" }],
      wellKnownURI: observationUri,
      is_healthy: true,
    };

    const unhealthyDup: RegistryAgentRecord = {
      ...healthy,
      wellKnownURI: `${observationUri}?dup=1`,
      is_healthy: false,
    };

    const choice = pickObservationControlAgent([unhealthyDup, healthy], "telenor.5g4data");

    expect(choice?.wellKnownURI).toBe(observationUri);
  });
});
