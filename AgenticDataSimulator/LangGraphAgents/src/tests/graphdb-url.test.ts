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
  resolveGraphDbInfraEndpoint,
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

test("resolveGraphDbEndpoint strips /sparql suffix from explicit endpoint", () => {
  assert.equal(
    resolveGraphDbEndpoint({
      endpoint: "http://127.0.0.1:7200/repositories/demo/sparql",
    }),
    "http://127.0.0.1:7200/repositories/demo",
  );
});

test("graphDbBaseUrlForCloneFromController rewrites localhost for containers", () => {
  assert.equal(
    graphDbBaseUrlForCloneFromController("http://127.0.0.1:7200/"),
    "http://host.docker.internal:7200/",
  );
});

test("rewriteGraphDbUrlForContainerAccess leaves public URLs unchanged on host", () => {
  const dockerEnvPath = join(tmpdir(), `dockerenv-${process.pid}`);
  writeFileSync(dockerEnvPath, "");
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
    if (existsSync(dockerEnvPath)) unlinkSync(dockerEnvPath);
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

test("resolveGraphDbInfraEndpoint defaults to telenor-infrastructure-5g4data", () => {
  assert.equal(
    resolveGraphDbInfraEndpoint({
      baseUrl: "http://127.0.0.1:7200/",
    }),
    "http://127.0.0.1:7200/repositories/telenor-infrastructure-5g4data",
  );
});

test("resolveGraphDbInfraEndpoint strips quoted repository ids from baked endpoints", () => {
  assert.equal(
    resolveGraphDbInfraEndpoint({
      endpoint:
        'http://host.docker.internal:7200/repositories/%22telenor-infrastructure-5g4data%22',
      repositoryId: "telenor-infrastructure-5g4data",
    }),
    "http://host.docker.internal:7200/repositories/telenor-infrastructure-5g4data",
  );
});
