import assert from "node:assert/strict";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  graphDbBaseUrlForCloneFromController,
  graphDbSparqlEndpointFromBase,
  repositoryIdFromGraphDbEndpoint,
  resolveGraphDbEndpoint,
  rewriteGraphDbUrlForContainerAccess,
} from "../graphdb-url.js";

test("resolveGraphDbEndpoint prefers explicit endpoint", () => {
  assert.equal(
    resolveGraphDbEndpoint({
      endpoint: "http://127.0.0.1:7200/repositories/demo/sparql",
    }),
    "http://127.0.0.1:7200/repositories/demo",
  );
});

test("resolveGraphDbEndpoint builds from base URL and repository id", () => {
  assert.equal(
    resolveGraphDbEndpoint({
      baseUrl: "http://127.0.0.1:7200",
      repositoryId: "demo-repo",
    }),
    "http://127.0.0.1:7200/repositories/demo-repo",
  );
});

test("graphDbBaseUrlForCloneFromController rewrites localhost for containers", () => {
  assert.equal(
    graphDbBaseUrlForCloneFromController("http://127.0.0.1:7200/"),
    "http://host.docker.internal:7200/",
  );
});

test("rewriteGraphDbUrlForContainerAccess leaves public URLs unchanged on host", () => {
  const previous = process.env.SIMULATOR_AGENT_CONTAINER;
  delete process.env.SIMULATOR_AGENT_CONTAINER;

  try {
    assert.equal(
      rewriteGraphDbUrlForContainerAccess(
        "https://start5g-1.cs.uit.no/graphdb/repositories/demo/sparql",
      ),
      "https://start5g-1.cs.uit.no/graphdb/repositories/demo/sparql",
    );
  } finally {
    if (previous === undefined) delete process.env.SIMULATOR_AGENT_CONTAINER;
    else process.env.SIMULATOR_AGENT_CONTAINER = previous;
  }
});

test("repositoryIdFromGraphDbEndpoint extracts repository segment", () => {
  assert.equal(
    repositoryIdFromGraphDbEndpoint(
      "https://example/graphdb/repositories/intents_and_intent_reports/sparql",
    ),
    "intents_and_intent_reports",
  );
  assert.equal(
    graphDbSparqlEndpointFromBase("http://host.docker.internal:7200/", "demo"),
    "http://host.docker.internal:7200/repositories/demo",
  );
});
