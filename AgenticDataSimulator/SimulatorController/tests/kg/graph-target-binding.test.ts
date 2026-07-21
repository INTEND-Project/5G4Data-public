import { describe, expect, it } from "vitest";

import {
  buildGraphTargetBinding,
  simulatorMetadataEnvelope,
} from "../../src/lib/kg/graph-target-binding";

describe("graph-target-binding", () => {
  it("builds SPARQL endpoint and repository base URL", () => {
    const binding = buildGraphTargetBinding(
      {
        id: "target-1",
        repositoryId: "telenor-demo",
        graphIri: "urn:intend:kg:demo",
        displayName: "Demo",
      },
      "http://graphdb:7200/",
    );

    expect(binding).toEqual({
      graphTargetId: "target-1",
      repositoryId: "telenor-demo",
      graphIri: "urn:intend:kg:demo",
      sparqlEndpoint: "http://graphdb:7200/repositories/telenor-demo/sparql",
      repositoryBaseUrl: "http://graphdb:7200/repositories/telenor-demo",
    });
  });

  it("wraps llm settings in simulator metadata envelope v1", () => {
    expect(
      simulatorMetadataEnvelope({
        llmModel: "codestral:latest",
        llmApiBaseUrl: "http://spark-88e2.taile6732f.ts.net:11434/v1",
        temperature: 0.25,
      }),
    ).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        llmModel: "codestral:latest",
        llmApiBaseUrl: "http://spark-88e2.taile6732f.ts.net:11434/v1",
        temperature: 0.25,
      },
    });
  });

  it("wraps reportingIntervalMinutes in simulator metadata envelope v1", () => {
    expect(simulatorMetadataEnvelope({ reportingIntervalMinutes: 15 })).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        reportingIntervalMinutes: 15,
      },
    });
  });

  it("wraps reportingIntervalSeconds in simulator metadata envelope v1", () => {
    expect(simulatorMetadataEnvelope({ reportingIntervalSeconds: 60 })).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        reportingIntervalSeconds: 60,
      },
    });
  });

  it("wraps binding in simulator metadata envelope v1", () => {
    const binding = buildGraphTargetBinding(
      { id: "t", repositoryId: "r", graphIri: "urn:g" },
      "http://host:7200",
    );
    expect(simulatorMetadataEnvelope({ graphTarget: binding })).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        graphTarget: binding,
      },
    });
  });
});
