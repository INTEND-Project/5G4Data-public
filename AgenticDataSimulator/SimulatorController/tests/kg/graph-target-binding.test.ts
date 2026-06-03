import { describe, expect, it } from "vitest";

import {
  buildGraphTargetBinding,
  openClawMetadataEnvelope,
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

  it("wraps llm settings in openclaw metadata envelope v1", () => {
    expect(
      openClawMetadataEnvelope({ llmModel: "gpt-4o-mini", temperature: 0.25 }),
    ).toEqual({
      openclaw: {
        controllerBindingVersion: "1",
        llmModel: "gpt-4o-mini",
        temperature: 0.25,
      },
    });
  });

  it("wraps binding in openclaw metadata envelope v1", () => {
    const binding = buildGraphTargetBinding(
      { id: "t", repositoryId: "r", graphIri: "urn:g" },
      "http://host:7200",
    );
    expect(openClawMetadataEnvelope({ graphTarget: binding })).toEqual({
      openclaw: {
        controllerBindingVersion: "1",
        graphTarget: binding,
      },
    });
  });
});
