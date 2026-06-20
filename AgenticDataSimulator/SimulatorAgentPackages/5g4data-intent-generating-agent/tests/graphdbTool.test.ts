import assert from "node:assert/strict";
import test from "node:test";

import { GraphDbTool } from "../tools/graphdbTool.js";

test("forInfrastructureLookup uses infra repository, not controller persist binding graph", () => {
  const tool = GraphDbTool.forInfrastructureLookup({
    graphDbEndpoint: "http://example/repositories/user-intent-repo",
    graphDbNamedGraph: "urn:intend:kg:user:intents",
    graphDbInfraEndpoint: "http://example/repositories/telenor-infrastructure-5g4data",
    graphDbInfraNamedGraph: "http://intendproject.eu/telenor/infra",
    graphDbQueryLimit: 0,
  });

  assert.equal(
    (tool as unknown as { endpoint: string }).endpoint,
    "http://example/repositories/telenor-infrastructure-5g4data",
  );
  assert.equal(
    (tool as unknown as { namedGraph: string }).namedGraph,
    "http://intendproject.eu/telenor/infra",
  );
});
