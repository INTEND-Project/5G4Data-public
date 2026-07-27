import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("registry client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example",
      GRAPHDB_BASE_URL: "http://graphdb.example",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("enriches paginated registry agents with domains from their well-known cards", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agents: [
              {
                name: "5g4data-intent-generating-agent",
                conformance: true,
                is_healthy: true,
                wellKnownURI:
                  "https://start5g-1.cs.uit.no/5g4data-intent-generating-agent/.well-known/agent-card.json",
              },
              {
                name: "5g4data-intent-observation-generating-agent",
                conformance: true,
                is_healthy: false,
                wellKnownURI:
                  "https://start5g-1.cs.uit.no/5g4data-intent-observation-generating-agent/.well-known/agent-card.json",
              },
            ],
            total: 2,
            limit: 20,
            offset: 0,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "5g4data-intent-generating-agent",
            domain: "telenor.5g4data",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "5g4data-intent-observation-generating-agent",
            domain: "telenor.5g4data",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const registryClientModule = await import("../../src/lib/registry/client");
    const agents = await registryClientModule.listNormalizedAgents({ forceRefresh: true });

    expect(agents).toEqual([
      {
        domain: "telenor.5g4data",
        isHealthy: true,
        name: "5g4data-intent-generating-agent",
        status: "conformant",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/5g4data-intent-generating-agent/.well-known/agent-card.json",
      },
      {
        domain: "telenor.5g4data",
        isHealthy: false,
        name: "5g4data-intent-observation-generating-agent",
        status: "conformant",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/5g4data-intent-observation-generating-agent/.well-known/agent-card.json",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("infers a shared domain when one well-known card is temporarily unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agents: [
              {
                name: "5g4data-intent-generating-agent",
                conformance: true,
                is_healthy: true,
                wellKnownURI:
                  "https://start5g-1.cs.uit.no/5g4data-intent-generating-agent/.well-known/agent-card.json",
                skills: [
                  {
                    tags: ["5g4data", "intent", "generation"],
                  },
                ],
              },
              {
                name: "5g4data-intent-observation-generating-agent",
                conformance: true,
                is_healthy: false,
                wellKnownURI:
                  "https://start5g-1.cs.uit.no/5g4data-intent-observation-generating-agent/.well-known/agent-card.json",
                skills: [
                  {
                    tags: ["5g4data", "intent", "observation", "reporting"],
                  },
                ],
              },
            ],
            total: 2,
            limit: 20,
            offset: 0,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "5g4data-intent-generating-agent",
            domain: "telenor.5g4data",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 502 }));

    vi.stubGlobal("fetch", fetchMock);

    const registryClientModule = await import("../../src/lib/registry/client");
    const agents = await registryClientModule.listNormalizedAgents({ forceRefresh: true });

    expect(agents).toEqual([
      {
        domain: "telenor.5g4data",
        isHealthy: true,
        name: "5g4data-intent-generating-agent",
        status: "conformant",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/5g4data-intent-generating-agent/.well-known/agent-card.json",
      },
      {
        domain: "telenor.5g4data",
        isHealthy: false,
        name: "5g4data-intent-observation-generating-agent",
        status: "conformant",
        wellKnownURI:
          "https://start5g-1.cs.uit.no/5g4data-intent-observation-generating-agent/.well-known/agent-card.json",
      },
    ]);
  });
});
