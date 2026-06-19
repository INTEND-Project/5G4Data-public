import test from "node:test";
import assert from "node:assert/strict";
import { startOpenApiServer } from "../core/httpApiServer.js";
import type { AgentCard } from "../core/a2a/service.js";

test("OpenAPI server handles sessions, turns, and agent card", async () => {
  const runtime = {
    async runTurn() {
      return {
        response: "ok",
        warnings: [],
        debug: []
      };
    },
    getDomainPackage() {
      return { manifest: { name: "demo", version: "0.1.0" } };
    },
    getAppConfig() {
      return { openClawModel: "demo-model" };
    }
  };
  const agentCard: AgentCard = {
    protocolVersion: "0.3.0",
    name: "demo",
    description: "demo",
    url: "http://localhost/v1",
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: []
  };
  const server = startOpenApiServer({
    runtime,
    host: "127.0.0.1",
    port: 0,
    agentCardPath: "/.well-known/agent-card.json",
    agentCard
  });
  const address = await server.listen();
  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionRes = await fetch(`${baseUrl}/v1/sessions`, { method: "POST" });
    assert.equal(sessionRes.status, 201);
    const session = (await sessionRes.json()) as { sessionId: string };
    assert.ok(session.sessionId.length > 0);

    const turnRes = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userText: "hello" })
    });
    assert.equal(turnRes.status, 200);
    const turn = (await turnRes.json()) as { response: string };
    assert.equal(turn.response, "ok");

    const openApiRes = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(openApiRes.status, 200);
    const openApi = (await openApiRes.json()) as { openapi: string };
    assert.equal(openApi.openapi, "3.1.0");

    const cardRes = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    assert.equal(cardRes.status, 200);
    const card = (await cardRes.json()) as { name: string };
    assert.equal(card.name, "demo");

    const a2aRpcPath = "/v1";
    const a2aRes = await fetch(`${baseUrl}${a2aRpcPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: "a2a" }]
          }
        }
      })
    });
    assert.equal(a2aRes.status, 200);
    const a2aBody = (await a2aRes.json()) as {
      result?: { kind: string; artifacts?: Array<{ parts: Array<{ text: string }> }> };
    };
    assert.equal(a2aBody.result?.kind, "task");
    assert.equal(a2aBody.result?.artifacts?.[0]?.parts?.[0]?.text, "ok");
  } finally {
    await server.close();
  }
});

test("JSON-RPC listens on /v1 when advertised card.url pathname includes proxy prefix", async () => {
  const runtime = {
    async runTurn() {
      return {
        response: "proxy",
        warnings: [],
        debug: []
      };
    },
    getDomainPackage() {
      return { manifest: { name: "demo", version: "0.1.0" } };
    },
    getAppConfig() {
      return { openClawModel: "demo-model" };
    }
  };
  const agentCard: AgentCard = {
    protocolVersion: "0.3.0",
    name: "demo",
    description: "demo",
    url: "https://example/5g4data-intent-generating-agent/v1",
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: []
  };
  const server = startOpenApiServer({
    runtime,
    host: "127.0.0.1",
    port: 0,
    agentCardPath: "/.well-known/agent-card.json",
    agentCard
  });
  const address = await server.listen();
  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const prefixed = `${baseUrl}/5g4data-intent-generating-agent/v1`;
    const prefixedRes = await fetch(prefixed, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", parts: [{ kind: "text", text: "x" }] } }
      })
    });
    assert.equal(prefixedRes.status, 404);

    const rootV1Res = await fetch(`${baseUrl}/v1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "message/send",
        params: { message: { role: "user", parts: [{ kind: "text", text: "x" }] } }
      })
    });
    assert.equal(rootV1Res.status, 200);
    const body = (await rootV1Res.json()) as {
      result?: { artifacts?: Array<{ parts: Array<{ text: string }> }> };
    };
    assert.equal(body.result?.artifacts?.[0]?.parts?.[0]?.text, "proxy");
  } finally {
    await server.close();
  }
});

test("OpenAPI server handles workload preview control endpoint", async () => {
  const runtime = {
    async runTurn() {
      return {
        response: "ok",
        warnings: [],
        debug: [],
      };
    },
    async resolveWorkloadPreview(prompt: string) {
      return {
        selectedChart: "rusty-llm",
        version: "0.1.0",
        objectives: [{ name: "p99-token-target" }],
        sustainability: [],
        metricStems: ["p99-token-target"],
        intentFlags: { deployment: true, sustainability: false, locality: false, networkQos: false },
        warnings: prompt.length ? [] : ["empty"],
      };
    },
    getDomainPackage() {
      return { manifest: { name: "demo", version: "0.1.0" } };
    },
    getAppConfig() {
      return { openClawModel: "demo-model" };
    },
  };
  const agentCard: AgentCard = {
    protocolVersion: "0.3.0",
    name: "demo",
    description: "demo",
    url: "http://localhost/v1",
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
  };
  const server = startOpenApiServer({
    runtime,
    host: "127.0.0.1",
    port: 0,
    agentCardPath: "/.well-known/agent-card.json",
    agentCard,
  });
  const address = await server.listen();
  try {
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const previewRes = await fetch(`${baseUrl}/v1/control/workload-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "small llm sustainable" }),
    });
    assert.equal(previewRes.status, 200);
    const preview = (await previewRes.json()) as { selectedChart: string };
    assert.equal(preview.selectedChart, "rusty-llm");
  } finally {
    await server.close();
  }
});
