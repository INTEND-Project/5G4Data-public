import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const dbMock = {
  scriptRunLog: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({ db: dbMock }));
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("run log routes", () => {
  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/run-logs/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/run-logs?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(401);
  });

  it("lists run logs for the authenticated user and domain", async () => {
    dbMock.scriptRunLog.findMany.mockResolvedValue([
      {
        id: "run-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        scriptName: "demo.dsl",
        scriptId: null,
        mode: "execute",
        lines: ["line 1"],
        startedAt: new Date("2026-05-28T10:00:00.000Z"),
        finishedAt: new Date("2026-05-28T10:01:00.000Z"),
      },
    ]);

    const routeModule = await import("../../src/app/api/run-logs/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/run-logs?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    expect(dbMock.scriptRunLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          domain: "telenor.5g4data",
        },
        take: 10,
      }),
    );
  });

  it("creates a run log and trims beyond 10 entries", async () => {
    dbMock.scriptRunLog.create.mockResolvedValue({
      id: "run-new",
      userId: "user-1",
      domain: "telenor.5g4data",
      scriptName: "demo.dsl",
      scriptId: null,
      mode: "dry-run",
      lines: ["done"],
      startedAt: new Date("2026-05-28T10:00:00.000Z"),
      finishedAt: new Date("2026-05-28T10:01:00.000Z"),
    });
    dbMock.scriptRunLog.findMany.mockResolvedValue([{ id: "run-new" }]);

    const routeModule = await import("../../src/app/api/run-logs/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/run-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          scriptName: "demo.dsl",
          mode: "dry-run",
          lines: ["done"],
          startedAt: "2026-05-28T10:00:00.000Z",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(dbMock.scriptRunLog.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        domain: "telenor.5g4data",
        id: {
          notIn: ["run-new"],
        },
      },
    });
  });

  it("deletes a single run log for the authenticated user and domain", async () => {
    dbMock.scriptRunLog.deleteMany.mockResolvedValue({ count: 1 });

    const routeModule = await import("../../src/app/api/run-logs/[id]/route");
    const response = await routeModule.DELETE(
      new Request("http://localhost/api/run-logs/run-1?domain=telenor.5g4data"),
      { params: Promise.resolve({ id: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(dbMock.scriptRunLog.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        userId: "user-1",
        domain: "telenor.5g4data",
      },
    });
  });

  it("returns 404 when deleting a missing run log", async () => {
    dbMock.scriptRunLog.deleteMany.mockResolvedValue({ count: 0 });

    const routeModule = await import("../../src/app/api/run-logs/[id]/route");
    const response = await routeModule.DELETE(
      new Request("http://localhost/api/run-logs/missing?domain=telenor.5g4data"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("deletes all run logs for the authenticated user and domain", async () => {
    dbMock.scriptRunLog.deleteMany.mockResolvedValue({ count: 3 });

    const routeModule = await import("../../src/app/api/run-logs/route");
    const response = await routeModule.DELETE(
      new Request("http://localhost/api/run-logs?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    expect(dbMock.scriptRunLog.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        domain: "telenor.5g4data",
      },
    });
  });
});
