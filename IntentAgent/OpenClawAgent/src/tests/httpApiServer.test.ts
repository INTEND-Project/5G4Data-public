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
  } finally {
    await server.close();
  }
});
