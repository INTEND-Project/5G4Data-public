import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const dbMock = {
  knowledgeGraphTarget: {
    findFirst: vi.fn(),
  },
};

const resolveIntentMetricCatalog = vi.fn();

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));

vi.mock("../../src/lib/kg/resolve-intent-metric-catalog", () => ({
  resolveIntentMetricCatalog,
}));

vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("POST /api/kg-targets/[id]/metric-catalog", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/kg-targets/[id]/metric-catalog/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/metric-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentLocalId: "I04fb0697e3a243e7a292c6cb57e9f797",
        }),
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(resolveIntentMetricCatalog).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid intent id", async () => {
    const routeModule = await import("../../src/app/api/kg-targets/[id]/metric-catalog/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/metric-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentLocalId: "not-an-intent-id",
        }),
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(resolveIntentMetricCatalog).not.toHaveBeenCalled();
  });

  it("resolves metrics from intent Turtle and returns sorted names", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    resolveIntentMetricCatalog.mockResolvedValue(["avail_COabc", "zlatency_COabc"]);

    const routeModule = await import("../../src/app/api/kg-targets/[id]/metric-catalog/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/metric-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentLocalId: "I04fb0697e3a243e7a292c6cb57e9f797",
        }),
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(resolveIntentMetricCatalog).toHaveBeenCalledWith({
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      metricNames: ["avail_COabc", "zlatency_COabc"],
      graphTargetId: "kg-target-1",
    });
  });

  it("returns 502 when metric catalog resolution throws", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    resolveIntentMetricCatalog.mockRejectedValue(new Error("GraphDB intent fetch failed with 418"));

    const routeModule = await import("../../src/app/api/kg-targets/[id]/metric-catalog/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/metric-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentLocalId: "I04fb0697e3a243e7a292c6cb57e9f797",
        }),
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "GraphDB intent fetch failed with 418",
    });
  });
});
