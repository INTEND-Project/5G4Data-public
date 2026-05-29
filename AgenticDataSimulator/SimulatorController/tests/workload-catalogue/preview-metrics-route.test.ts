import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

const registryMock = {
  listRegistryRecords: vi.fn(),
};

const envMock = {
  loadAppEnv: vi.fn(() => ({
    agentApiKeys: {},
    agentApiKey: undefined,
    agentApiKeyHeader: "X-Api-Key",
  })),
};

vi.mock("../../src/lib/auth/guards", () => guardMock);
vi.mock("../../src/lib/registry/client", () => registryMock);
vi.mock("../../src/lib/env", () => envMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
  registryMock.listRegistryRecords.mockResolvedValue([
    {
      name: "5g4data-intent-generating-agent",
      domain: "telenor.5g4data",
      wellKnownURI: "https://agent.example/.well-known/agent-card.json",
      description: "Generates intent definitions and deployment-ready payload guidance.",
      agent_card: {
        domain: "telenor.5g4data",
        name: "5g4data-intent-generating-agent",
      },
    },
  ]);
});

describe("workload catalogue preview-metrics route", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);
    const routeModule = await import("../../src/app/api/workload-catalogue/preview-metrics/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/workload-catalogue/preview-metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Deploy LLM", domain: "telenor.5g4data" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("proxies preview to discovered intent agent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/.well-known/agent-card.json")) {
        return new Response(
          JSON.stringify({ url: "https://agent.example/v1", name: "intent-agent" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/control/workload-preview")) {
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body));
        expect(body.prompt).toBe("Deploy small llm");
        return new Response(
          JSON.stringify({
            selectedChart: "rusty-llm",
            version: "0.1.19",
            objectives: [{ name: "p99-token-target" }],
            sustainability: [{ name: "container-cpu-watts" }],
            metricStems: ["container-cpu-watts", "p99-token-target"],
            warnings: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const routeModule = await import("../../src/app/api/workload-catalogue/preview-metrics/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/workload-catalogue/preview-metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Deploy small llm", domain: "telenor.5g4data" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selectedChart: "rusty-llm",
      metricStems: ["container-cpu-watts", "p99-token-target"],
    });
    fetchMock.mockRestore();
  });

  it("returns clear error when agent preview endpoint is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/.well-known/agent-card.json")) {
        return new Response(JSON.stringify({ url: "https://agent.example/v1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/control/workload-preview")) {
        return new Response(JSON.stringify({ error: "Not implemented" }), { status: 501 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const routeModule = await import("../../src/app/api/workload-catalogue/preview-metrics/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/workload-catalogue/preview-metrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Deploy", domain: "telenor.5g4data" }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Intent agent does not support workload preview; restart the agent after upgrading.",
    });
    fetchMock.mockRestore();
  });
});
