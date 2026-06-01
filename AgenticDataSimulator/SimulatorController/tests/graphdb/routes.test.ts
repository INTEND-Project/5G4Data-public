import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const userIntentRegistryMock = {
  unregisterGraphStoredIntentsForTarget: vi.fn(),
};

const listIntentsMock = {
  invalidateLiteListCache: vi.fn(),
};

const dbMock = {
  knowledgeGraphTarget: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

const graphDbClientMock = {
  createRepository: vi.fn(),
  createNamedGraph: vi.fn(),
  deleteRepository: vi.fn(),
  clearKnowledgeGraph: vi.fn(),
  ingestIntentTurtle: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));

vi.mock("../../src/lib/graphdb/client", () => graphDbClientMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);
vi.mock("../../src/lib/intents/user-intent-registry", () => userIntentRegistryMock);
vi.mock("../../src/lib/intents/list-intents", () => listIntentsMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
  userIntentRegistryMock.unregisterGraphStoredIntentsForTarget.mockResolvedValue(undefined);
  listIntentsMock.invalidateLiteListCache.mockImplementation(() => undefined);
});

describe("kg target routes", () => {
  it("lists persisted knowledge graph targets by domain for the authenticated user", async () => {
    dbMock.knowledgeGraphTarget.findMany.mockResolvedValue([
      {
        id: "kg-target-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        repositoryId: "telenor-5g4data-kg-avalanche-demo",
        graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
        displayName: "KG Avalanche Demo",
      },
    ]);

    const routeModule = await import("../../src/app/api/kg-targets/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/kg-targets?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      targets: [
        {
          id: "kg-target-1",
          userId: "user-1",
          domain: "telenor.5g4data",
          repositoryId: "telenor-5g4data-kg-avalanche-demo",
          graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
          displayName: "KG Avalanche Demo",
        },
      ],
    });
  });

  it("creates the repository, named graph, and persisted target record", async () => {
    graphDbClientMock.createRepository.mockResolvedValue(undefined);
    graphDbClientMock.createNamedGraph.mockResolvedValue(undefined);
    dbMock.knowledgeGraphTarget.create.mockResolvedValue({
      id: "kg-target-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
      displayName: "KG Avalanche Demo",
    });

    const routeModule = await import("../../src/app/api/kg-targets/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          displayName: "KG Avalanche Demo",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      target: {
        id: "kg-target-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        repositoryId: "telenor-5g4data-kg-avalanche-demo",
        graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
        displayName: "KG Avalanche Demo",
      },
    });
  });

  it("does not persist a target when GraphDB repository creation fails", async () => {
    graphDbClientMock.createRepository.mockRejectedValue(new Error("GraphDB repository creation failed with 500"));

    const routeModule = await import("../../src/app/api/kg-targets/route");

    await expect(
      routeModule.POST(
        new Request("http://localhost/api/kg-targets", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            domain: "telenor.5g4data",
            displayName: "KG Avalanche Demo",
          }),
        }),
      ),
    ).rejects.toThrow("GraphDB repository creation failed with 500");
    expect(dbMock.knowledgeGraphTarget.create).not.toHaveBeenCalled();
    expect(graphDbClientMock.createNamedGraph).not.toHaveBeenCalled();
  });

  it("deletes the GraphDB repository before removing the local KG target", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
      displayName: "KG Avalanche Demo",
    });
    graphDbClientMock.deleteRepository.mockResolvedValue(undefined);
    dbMock.knowledgeGraphTarget.delete.mockResolvedValue({
      id: "kg-target-1",
    });

    const routeModule = await import("../../src/app/api/kg-targets/[id]/route");
    const response = await routeModule.DELETE(
      new Request("http://localhost/api/kg-targets/kg-target-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(graphDbClientMock.deleteRepository).toHaveBeenCalledWith({
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
    });
    expect(dbMock.knowledgeGraphTarget.delete).toHaveBeenCalledWith({
      where: {
        id: "kg-target-1",
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedTargetId: "kg-target-1",
    });
  });

  it("does not delete the local KG target when GraphDB delete fails", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
      displayName: "KG Avalanche Demo",
    });
    graphDbClientMock.deleteRepository.mockRejectedValue(
      new Error("GraphDB repository deletion failed with 500"),
    );

    const routeModule = await import("../../src/app/api/kg-targets/[id]/route");

    await expect(
      routeModule.DELETE(
        new Request("http://localhost/api/kg-targets/kg-target-1", {
          method: "DELETE",
        }),
        {
          params: Promise.resolve({
            id: "kg-target-1",
          }),
        },
      ),
    ).rejects.toThrow("GraphDB repository deletion failed with 500");

    expect(dbMock.knowledgeGraphTarget.delete).not.toHaveBeenCalled();
  });

  it("empties triples in GraphDB without removing the local KG target", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
      displayName: "KG Avalanche Demo",
    });
    graphDbClientMock.clearKnowledgeGraph.mockResolvedValue(undefined);

    const routeModule = await import("../../src/app/api/kg-targets/[id]/empty/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/empty", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(graphDbClientMock.clearKnowledgeGraph).toHaveBeenCalledWith({
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    expect(userIntentRegistryMock.unregisterGraphStoredIntentsForTarget).toHaveBeenCalledWith(
      "user-1",
      "kg-target-1",
    );
    expect(listIntentsMock.invalidateLiteListCache).toHaveBeenCalled();
    expect(dbMock.knowledgeGraphTarget.delete).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      emptiedTargetId: "kg-target-1",
    });
  });

  it("returns 502 when clearKnowledgeGraph throws", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    graphDbClientMock.clearKnowledgeGraph.mockRejectedValue(
      new Error("GraphDB knowledge graph clear failed with 500"),
    );

    const routeModule = await import("../../src/app/api/kg-targets/[id]/empty/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/empty", {
        method: "POST",
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "GraphDB knowledge graph clear failed with 500",
    });
  });

  it("ingests Turtle into GraphDB using the persisted repository id and named graph iri", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    graphDbClientMock.ingestIntentTurtle.mockResolvedValue(undefined);

    const turtle = `@prefix icm: <http://example/icm/> .\n _:x a icm:Intent .\n`;

    const routeModule = await import("../../src/app/api/kg-targets/[id]/store-intent/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/store-intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ turtle }),
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(graphDbClientMock.ingestIntentTurtle).toHaveBeenCalledWith({
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
      turtle,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      intentId: null,
      graphTargetId: "kg-target-1",
    });
  });

  it("returns 502 when ingestIntentTurtle throws", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-target-1",
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      graphIri: "urn:intend:kg:telenor-5g4data:kg-avalanche-demo",
    });
    graphDbClientMock.ingestIntentTurtle.mockRejectedValue(new Error("GraphDB intent ingest failed with 418"));

    const routeModule = await import("../../src/app/api/kg-targets/[id]/store-intent/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/kg-targets/kg-target-1/store-intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ turtle: "@prefix icm: <http://x/> .\n _:a a icm:Intent .\n" }),
      }),
      {
        params: Promise.resolve({
          id: "kg-target-1",
        }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "GraphDB intent ingest failed with 418",
    });
  });
});
