import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { buildAgentCard } from "../core/a2a/service.js";
import { startOpenApiServer } from "../core/httpApiServer.js";

const baseA2AConfig = {
  a2aEnabled: true,
  a2aRegistryBaseUrl: "http://registry.local:8000",
  a2aAgentBaseUrl: "http://agent.local:3010",
  a2aAgentCardPath: "/.well-known/agent-card.json",
  a2aAutoRegisterOnStartup: false,
  agentApiKey: "test-agent-key",
  agentApiKeyHeader: "X-Api-Key"
};

const mockRuntime = {
  runTurn: async () => ({
    response: "ok",
    warnings: [],
    debug: [],
    intentUsageSummary: null
  }),
  getDomainPackage: () => ({
    manifest: { name: "demo-package", version: "1.0.0" },
    intentBindingMetadata: null
  }),
  getAppConfig: () => ({ openClawModel: "test-model" })
};

test("httpApiServer rejects protected routes without API key", async () => {
  const card = buildAgentCard(baseA2AConfig, {
    manifest: { name: "demo-package", version: "1.0.0" }
  } as never);
  const server = startOpenApiServer({
    runtime: mockRuntime as never,
    host: "127.0.0.1",
    port: 0,
    agentCardPath: baseA2AConfig.a2aAgentCardPath,
    agentCard: card,
    agentApiKey: baseA2AConfig.agentApiKey,
    agentApiKeyHeader: baseA2AConfig.agentApiKeyHeader
  });
  const listening = await server.listen();
  const baseUrl = `http://${listening.host}:${listening.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);

    const denied = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      headers: { "X-Api-Key": "test-agent-key" }
    });
    assert.equal(allowed.status, 200);
  } finally {
    await server.close();
  }
});
