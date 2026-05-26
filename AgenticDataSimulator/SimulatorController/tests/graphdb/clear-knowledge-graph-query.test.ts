import { describe, expect, it } from "vitest";

import {
  INTENT_REPORTS_METADATA_GRAPH_IRI,
  buildClearKnowledgeGraphUpdate,
} from "../../src/lib/graphdb/clear-knowledge-graph-query";

describe("buildClearKnowledgeGraphUpdate", () => {
  it("clears the default graph, metadata graph, and target named graph", () => {
    expect(buildClearKnowledgeGraphUpdate("urn:intend:kg:telenor-5g4data:kg-avalanche-demo")).toBe(
      `CLEAR DEFAULT ;
CLEAR GRAPH <${INTENT_REPORTS_METADATA_GRAPH_IRI}> ;
CLEAR GRAPH <urn:intend:kg:telenor-5g4data:kg-avalanche-demo> ;`,
    );
  });
});
