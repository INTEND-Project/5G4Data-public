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

const listIntentsForKgTargetMock = vi.fn();

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));

vi.mock("../../src/lib/kg/list-intents-for-target", () => ({
  listIntentsForKgTarget: listIntentsForKgTargetMock,
}));

vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("GET /api/kg-targets/[id]/intents", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/kg-targets/[id]/intents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/kg-targets/kg-1/intents"),
      { params: Promise.resolve({ id: "kg-1" }) },
    );

    expect(response.status).toBe(401);
    expect(listIntentsForKgTargetMock).not.toHaveBeenCalled();
  });

  it("returns 404 when target is missing", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/kg-targets/[id]/intents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/kg-targets/kg-1/intents"),
      { params: Promise.resolve({ id: "kg-1" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns intents from GraphDB list helper", async () => {
    dbMock.knowledgeGraphTarget.findFirst.mockResolvedValue({
      id: "kg-1",
      repositoryId: "repo-a",
      graphIri: "http://example/graph",
    });
    listIntentsForKgTargetMock.mockResolvedValue([
      { intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", description: "Test intent" },
    ]);

    const routeModule = await import("../../src/app/api/kg-targets/[id]/intents/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/kg-targets/kg-1/intents"),
      { params: Promise.resolve({ id: "kg-1" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.intents).toEqual([
      { intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", description: "Test intent" },
    ]);
    expect(listIntentsForKgTargetMock).toHaveBeenCalledWith({
      repositoryId: "repo-a",
      graphIri: "http://example/graph",
      graphDbBaseUrl: undefined,
    });
  });
});
