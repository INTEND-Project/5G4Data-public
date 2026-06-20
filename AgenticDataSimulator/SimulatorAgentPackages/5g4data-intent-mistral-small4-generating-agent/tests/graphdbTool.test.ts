import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSparqlPostEndpoint } from "../tools/graphdbTool.js";

test("normalizeSparqlPostEndpoint uses repository base URL for GraphDB POST", () => {
  assert.equal(
    normalizeSparqlPostEndpoint(
      "http://host.docker.internal:7200/repositories/intents_and_intent_reports/sparql",
    ),
    "http://host.docker.internal:7200/repositories/intents_and_intent_reports",
  );
  assert.equal(
    normalizeSparqlPostEndpoint(
      "http://host.docker.internal:7200/repositories/demo",
    ),
    "http://host.docker.internal:7200/repositories/demo",
  );
});
