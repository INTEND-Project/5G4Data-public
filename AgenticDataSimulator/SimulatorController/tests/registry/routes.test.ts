import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = {
  listNormalizedAgents: vi.fn(),
};

vi.mock("../../src/lib/registry/client", () => clientMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("registry routes", () => {
  it("returns unique domains derived from normalized agents", async () => {
    clientMock.listNormalizedAgents.mockResolvedValue([
      {
        name: "5g4data-intent-generation-agent",
        domain: "telenor.5g4data",
        isHealthy: true,
        wellKnownURI: null,
        status: "unknown",
      },
      {
        name: "5g4data-observation-generation-agent",
        domain: "telenor.5g4data",
        isHealthy: false,
        wellKnownURI: null,
        status: "unknown",
      },
      {
        name: "power-reduction-status-agent",
        domain: "telenor.5gPowerReduction",
        isHealthy: null,
        wellKnownURI: null,
        status: "unknown",
      },
    ]);

    const routeModule = await import("../../src/app/api/domains/route");
    const response = await routeModule.GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      domains: ["telenor.5g4data", "telenor.5gPowerReduction"],
    });
  });

  it("filters normalized agents by domain", async () => {
    clientMock.listNormalizedAgents.mockResolvedValue([
      {
        name: "5g4data-intent-generation-agent",
        domain: "telenor.5g4data",
        isHealthy: true,
        wellKnownURI: null,
        status: "unknown",
      },
      {
        name: "power-reduction-status-agent",
        domain: "telenor.5gPowerReduction",
        isHealthy: false,
        wellKnownURI: null,
        status: "unknown",
      },
    ]);

    const routeModule = await import("../../src/app/api/agents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/agents?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agents: [
        {
          name: "5g4data-intent-generation-agent",
          domain: "telenor.5g4data",
          isHealthy: true,
          wellKnownURI: null,
          status: "unknown",
        },
      ],
    });
  });

  it("forces a registry refresh when requested by query parameter", async () => {
    clientMock.listNormalizedAgents.mockResolvedValue([
      {
        name: "5g4data-intent-generation-agent",
        domain: "telenor.5g4data",
        isHealthy: true,
        wellKnownURI: null,
        status: "unknown",
      },
    ]);

    const routeModule = await import("../../src/app/api/agents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/agents?domain=telenor.5g4data&refresh=1"),
    );

    expect(clientMock.listNormalizedAgents).toHaveBeenCalledWith({ forceRefresh: true });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agents: [
        {
          name: "5g4data-intent-generation-agent",
          domain: "telenor.5g4data",
          isHealthy: true,
          wellKnownURI: null,
          status: "unknown",
        },
      ],
    });
  });
});
