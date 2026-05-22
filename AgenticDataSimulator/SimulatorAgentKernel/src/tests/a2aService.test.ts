import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAgentCard,
  buildWellKnownAgentCardUrl,
  persistAgentCard,
  registerAgentCard,
  type A2AConfig
} from "../core/a2a/service.js";

const baseConfig: A2AConfig = {
  a2aEnabled: true,
  a2aRegistryBaseUrl: "http://registry.local:8000",
  a2aAgentBaseUrl: "http://agent.local:3010",
  a2aAgentCardPath: "/.well-known/agent-card.json",
  a2aAutoRegisterOnStartup: true
};

const mockPackage = {
  manifest: { name: "demo-package", version: "1.2.3" }
} as const;

test("buildAgentCard and persistAgentCard writes well-known file", () => {
  const card = buildAgentCard(
    baseConfig,
    {
      ...mockPackage,
      agentCardPartial: {
        name: "custom-name",
        description: "custom-desc",
        domain: "telenor.5g4data",
        skills: [
          {
            id: "s1",
            name: "Skill 1",
            description: "Test skill"
          }
        ]
      }
    } as never
  );
  assert.equal(card.name, "custom-name");
  assert.equal(card.description, "custom-desc");
  assert.equal(card.domain, "telenor.5g4data");
  assert.equal(card.skills[0]?.id, "s1");
  assert.equal(card.url, "http://agent.local:3010/custom-name/v1");
  assert.equal(
    buildWellKnownAgentCardUrl(baseConfig, card.name),
    "http://agent.local:3010/custom-name/.well-known/agent-card.json"
  );

  const root = mkdtempSync(join(tmpdir(), "a2a-card-"));
  const savedPath = persistAgentCard(root, card, baseConfig.a2aAgentCardPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8")) as {
    name: string;
    version: string;
    domain?: string;
  };
  assert.equal(saved.name, "custom-name");
  assert.equal(saved.version, "1.2.3");
  assert.equal(saved.domain, "telenor.5g4data");
});

test("registerAgentCard treats 409 as idempotent success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('{"detail":"already exists"}', {
      status: 409,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
  try {
    const result = await registerAgentCard(baseConfig, "custom-name");
    assert.equal(result.attempted, true);
    assert.equal(result.ok, true);
    assert.equal(result.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
