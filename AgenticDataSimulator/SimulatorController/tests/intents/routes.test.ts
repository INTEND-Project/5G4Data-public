import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const dbMock = {
  knowledgeGraphTarget: {
    findMany: vi.fn(),
  },
};

const listIntentsMock = {
  listIntentsForDomain: vi.fn(),
  resolveIntentOwner: vi.fn(),
};

const userIntentRegistryMock = {
  listOwnedIntentIdsForUser: vi.fn(),
  assertUserOwnsIntent: vi.fn(),
};

const graphdbClientMock = {
  runRepositorySparqlUpdate: vi.fn(),
};

const observationBoundsMock = {
  fetchCompoundMetricsForIntent: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({ db: dbMock }));
vi.mock("../../src/lib/intents/list-intents", () => listIntentsMock);
vi.mock("../../src/lib/intents/user-intent-registry", () => userIntentRegistryMock);
vi.mock("../../src/lib/graphdb/client", () => graphdbClientMock);
vi.mock("../../src/lib/intents/observation-time-bounds", () => observationBoundsMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
  dbMock.knowledgeGraphTarget.findMany.mockResolvedValue([
    {
      repositoryId: "repo-1",
      graphIri: "http://example/graph",
    },
  ]);
  userIntentRegistryMock.listOwnedIntentIdsForUser.mockResolvedValue([
    "I04fb0697e3a243e7a292c6cb57e9f797",
  ]);
  userIntentRegistryMock.assertUserOwnsIntent.mockResolvedValue(true);
});

describe("intents routes", () => {
  it("lists intents for the authenticated user", async () => {
    listIntentsMock.listIntentsForDomain.mockResolvedValue([
      {
        intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
        storage: "prometheus",
        grafanaUrl: "http://grafana.example/d/abc/intent-dashboard?from=1779337715000&to=1779428795000",
        repositoryId: "repo-1",
        graphIri: "http://example/graph",
        dataStatus: "ready",
        metricsReady: 2,
        metricsTotal: 2,
      },
    ]);

    const routeModule = await import("../../src/app/api/intents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/intents?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    expect(userIntentRegistryMock.listOwnedIntentIdsForUser).toHaveBeenCalledWith(
      "user-1",
      "telenor.5g4data",
    );
    expect(listIntentsMock.listIntentsForDomain).toHaveBeenCalledWith(
      [
        {
          repositoryId: "repo-1",
          graphIri: "http://example/graph",
        },
      ],
      {
        mode: "full",
        cacheKey: undefined,
        ownedIntentIds: ["I04fb0697e3a243e7a292c6cb57e9f797"],
        grafanaLoginUsername: "alice",
      },
    );
    await expect(response.json()).resolves.toEqual({
      intents: [
        {
          intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
          storage: "prometheus",
          grafanaUrl: "http://grafana.example/d/abc/intent-dashboard?from=1779337715000&to=1779428795000",
          repositoryId: "repo-1",
          graphIri: "http://example/graph",
          dataStatus: "ready",
          metricsReady: 2,
          metricsTotal: 2,
        },
      ],
    });
  });

  it("lists intents in lite mode with cache key", async () => {
    listIntentsMock.listIntentsForDomain.mockResolvedValue([]);

    const routeModule = await import("../../src/app/api/intents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/intents?domain=telenor.5g4data&lite=1"),
    );

    expect(response.status).toBe(200);
    expect(listIntentsMock.listIntentsForDomain).toHaveBeenCalledWith(
      [
        {
          repositoryId: "repo-1",
          graphIri: "http://example/graph",
        },
      ],
      {
        mode: "lite",
        cacheKey:
          "user-1:telenor.5g4data:I04fb0697e3a243e7a292c6cb57e9f797:repo-1|http://example/graph::",
        ownedIntentIds: ["I04fb0697e3a243e7a292c6cb57e9f797"],
        grafanaLoginUsername: "alice",
        prometheusBaseUrl: undefined,
        graphDbBaseUrl: undefined,
      },
    );
  });

  it("returns 400 when domain is missing", async () => {
    const routeModule = await import("../../src/app/api/intents/route");
    const response = await routeModule.GET(new Request("http://localhost/api/intents"));

    expect(response.status).toBe(400);
  });

  it("clears graphdb observations for a valid intent id", async () => {
    const intentId = "I04fb0697e3a243e7a292c6cb57e9f797";
    listIntentsMock.resolveIntentOwner.mockResolvedValue({
      repositoryId: "repo-1",
      graphIri: "http://example/graph",
    });
    observationBoundsMock.fetchCompoundMetricsForIntent.mockResolvedValue(["metric_COabc123"]);
    graphdbClientMock.runRepositorySparqlUpdate.mockResolvedValue(undefined);

    const routeModule = await import("../../src/app/api/intents/[intentId]/empty-graphdb/route");
    const response = await routeModule.POST(
      new Request(
        `http://localhost/api/intents/${encodeURIComponent(intentId)}/empty-graphdb?domain=telenor.5g4data`,
      ),
      {
        params: Promise.resolve({ intentId }),
      },
    );

    expect(response.status).toBe(200);
    expect(userIntentRegistryMock.assertUserOwnsIntent).toHaveBeenCalledWith("user-1", intentId);
    expect(graphdbClientMock.runRepositorySparqlUpdate).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      clearedIntentId: intentId,
      repositoryId: "repo-1",
      graphIri: "http://example/graph",
      compoundMetrics: ["metric_COabc123"],
    });
  });
});
