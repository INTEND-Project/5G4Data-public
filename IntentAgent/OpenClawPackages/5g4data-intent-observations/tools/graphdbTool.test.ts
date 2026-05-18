import test from "node:test";
import assert from "node:assert/strict";
import { GraphDbTool } from "./graphdbTool.js";
import { effectiveGraphDbEnv } from "./graphTargetBinding.js";

test("GraphDbTool.fromBinding uses controller SPARQL endpoint and named graph", () => {
  const fallback = {
    graphDbEndpoint: "http://fallback/sparql",
    graphDbNamedGraph: "urn:env:graph",
    graphDbQueryLimit: 50,
  };
  const tool = GraphDbTool.fromBinding(
    {
      repositoryId: "repo-x",
      graphIri: "urn:intend:kg:x",
      sparqlEndpoint: "http://gdb/repositories/repo-x/sparql",
      repositoryBaseUrl: "http://gdb/repositories/repo-x",
    },
    fallback,
  );
  assert.ok(tool instanceof GraphDbTool);
  const env = effectiveGraphDbEnv(
    {
      repositoryId: "repo-x",
      graphIri: "urn:intend:kg:x",
      sparqlEndpoint: "http://gdb/repositories/repo-x/sparql",
      repositoryBaseUrl: "http://gdb/repositories/repo-x",
    },
    fallback,
  );
  assert.equal(env.graphDbEndpoint, "http://gdb/repositories/repo-x/sparql");
  assert.equal(env.graphDbNamedGraph, "urn:intend:kg:x");
  assert.equal(env.repositoryBaseUrl, "http://gdb/repositories/repo-x");
});

test("getIntentTurtle scopes CONSTRUCT to named graph when configured", async () => {
  const originalFetch = globalThis.fetch;
  let postedQuery = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postedQuery = String(init?.body ?? "");
    return new Response("@prefix ex: <http://ex/> .\nex:s ex:p ex:o .\n", {
      status: 200,
      headers: { "content-type": "text/turtle" },
    });
  }) as typeof fetch;

  try {
    const tool = GraphDbTool.fromBinding(
      {
        repositoryId: "repo-x",
        graphIri: "urn:intend:kg:x",
        sparqlEndpoint: "http://gdb/repositories/repo-x/sparql",
        repositoryBaseUrl: "http://gdb/repositories/repo-x",
      },
      {
        graphDbEndpoint: "http://fallback/sparql",
        graphDbNamedGraph: "urn:env",
        graphDbQueryLimit: 0,
      },
    );
    const ttl = await tool.getIntentTurtle("I6be57670fcad46fba1f648ad28b9cdb5");
    assert.ok(ttl?.includes("ex:s"));
    assert.match(postedQuery, /GRAPH <urn:intend:kg:x>/);
    assert.match(postedQuery, /#I6be57670fcad46fba1f648ad28b9cdb5/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
