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

test("storeGraphdbMetadata posts SPARQL update to metadata graph", async () => {
  const originalFetch = globalThis.fetch;
  let postedUrl = "";
  let postedBody = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    postedUrl = String(input);
    postedBody = String(init?.body ?? "");
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const tool = GraphDbTool.fromBinding(
      {
        repositoryId: "intents_and_intent_reports",
        graphIri: "http://intent-reports",
        sparqlEndpoint: "http://start5g-1.cs.uit.no:7200/repositories/intents_and_intent_reports/sparql",
        repositoryBaseUrl: "http://start5g-1.cs.uit.no:7200/repositories/intents_and_intent_reports",
      },
      {
        graphDbEndpoint: "http://fallback/sparql",
        graphDbNamedGraph: "urn:env",
        graphDbQueryLimit: 0,
      },
    );
    const metric = "throughput_CO6be57670fcad46fba1f648ad28b9cdb5";
    const ok = await tool.storeGraphdbMetadata(metric);
    assert.equal(ok, true);
    assert.match(postedUrl, /\/repositories\/intents_and_intent_reports\/statements$/);
    assert.match(postedBody, /GRAPH <http:\/\/intent-reports-metadata>/);
    assert.match(postedBody, new RegExp(`#${metric}`));
    assert.match(
      postedBody,
      /repositories\/intents_and_intent_reports\?query=/
    );
    assert.match(decodeURIComponent(postedBody), /SERVICE <repository:intents_and_intent_reports>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("storePrometheusMetadata posts readable and encoded query URLs", async () => {
  const originalFetch = globalThis.fetch;
  let postedBody = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postedBody = String(init?.body ?? "");
    return new Response("", { status: 200 });
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
    const metric = "latency_COb1b2c3d4e5f678901234567890abcd";
    const ok = await tool.storePrometheusMetadata(metric, "http://prom:9090");
    assert.equal(ok, true);
    assert.match(postedBody, /GRAPH <http:\/\/intent-reports-metadata>/);
    assert.match(postedBody, /data5g:latency_COb1b2c3d4e5f678901234567890abcd/);
    assert.match(postedBody, /hasReadableQuery "latency_COb1b2c3d4e5f678901234567890abcd\{job=\\"intent_reports\\"\}"/);
    assert.match(postedBody, /http:\/\/prom:9090\/api\/v1\/query\?query=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
