import { describe, expect, it } from "vitest";

import {
  agentSlugFromWellKnownUri,
  buildA2AAuthHeaders,
  resolveAgentApiKey,
} from "@/lib/a2a/auth-headers";
import { loadAppEnv } from "@/lib/env";

describe("auth-headers", () => {
  const env = loadAppEnv({
    DATABASE_URL: "file:./dev.db",
    AGENT_API_KEYS: JSON.stringify({
      "5g4data-intent-generating-agent": "intent-key",
      "5g4data-intent-observation-generating-agent": "observation-key",
    }),
    AGENT_API_KEY: "fallback-key",
    AGENT_API_KEY_HEADER: "X-Api-Key",
  });

  it("resolves key by agent card name", () => {
    expect(resolveAgentApiKey("5g4data-intent-generating-agent", env)).toBe("intent-key");
  });

  it("resolves key by well-known URI slug", () => {
    expect(
      resolveAgentApiKey(
        undefined,
        env,
        "https://host.example/5g4data-intent-observation-generating-agent/.well-known/agent-card.json",
      ),
    ).toBe("observation-key");
  });

  it("extracts slug from well-known URI", () => {
    expect(
      agentSlugFromWellKnownUri(
        "https://host.example/simulator-agents/5g4data-intent-generating-agent/.well-known/agent-card.json",
      ),
    ).toBe("5g4data-intent-generating-agent");
  });

  it("builds header from card security scheme", () => {
    expect(
      buildA2AAuthHeaders(env, {
        card: {
          name: "5g4data-intent-generating-agent",
          securitySchemes: {
            "agent-api-key": { type: "apiKey", in: "header", name: "X-Api-Key" },
          },
        },
      }),
    ).toEqual({ "X-Api-Key": "intent-key" });
  });
});
