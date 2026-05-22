import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const dbMock = {
  script: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));

vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("script route handlers", () => {
  it("lists scripts for the authenticated user and selected domain", async () => {
    dbMock.script.findMany.mockResolvedValue([
      {
        id: "script-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        name: "avalanche-search.control.dsl",
        content: "discover intent-agent by domain 5g4data as intentGen",
        lastRunMode: "dry-run",
      },
    ]);

    const routeModule = await import("../../src/app/api/scripts/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/scripts?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      scripts: [
        {
          id: "script-1",
          userId: "user-1",
          domain: "telenor.5g4data",
          name: "avalanche-search.control.dsl",
          content: "discover intent-agent by domain 5g4data as intentGen",
          lastRunMode: "dry-run",
        },
      ],
    });
  });

  it("creates a script for the authenticated user", async () => {
    dbMock.script.create.mockResolvedValue({
      id: "script-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      name: "avalanche-search.control.dsl",
      content: "",
      lastRunMode: null,
    });

    const routeModule = await import("../../src/app/api/scripts/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/scripts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          name: "avalanche-search.control.dsl",
          content: "",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      script: {
        id: "script-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        name: "avalanche-search.control.dsl",
        content: "",
        lastRunMode: null,
      },
    });
  });

  it("returns a specific script only when it belongs to the authenticated user", async () => {
    dbMock.script.findFirst.mockResolvedValue({
      id: "script-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      name: "avalanche-search.control.dsl",
      content: "discover intent-agent by domain 5g4data as intentGen",
      lastRunMode: "dry-run",
    });

    const routeModule = await import("../../src/app/api/scripts/[id]/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/scripts/script-1"),
      {
        params: Promise.resolve({ id: "script-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      script: {
        id: "script-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        name: "avalanche-search.control.dsl",
        content: "discover intent-agent by domain 5g4data as intentGen",
        lastRunMode: "dry-run",
      },
    });
  });

  it("updates and deletes a user-owned script", async () => {
    dbMock.script.findFirst.mockResolvedValue({
      id: "script-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      name: "avalanche-search.control.dsl",
      content: "draft",
      lastRunMode: null,
    });
    dbMock.script.update.mockResolvedValue({
      id: "script-1",
      userId: "user-1",
      domain: "telenor.5g4data",
      name: "avalanche-search-v2.control.dsl",
      content: "updated script",
      lastRunMode: "execute",
    });
    dbMock.script.delete.mockResolvedValue({
      id: "script-1",
    });

    const routeModule = await import("../../src/app/api/scripts/[id]/route");
    const patchResponse = await routeModule.PATCH(
      new Request("http://localhost/api/scripts/script-1", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "avalanche-search-v2.control.dsl",
          content: "updated script",
          lastRunMode: "execute",
        }),
      }),
      {
        params: Promise.resolve({ id: "script-1" }),
      },
    );

    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toEqual({
      script: {
        id: "script-1",
        userId: "user-1",
        domain: "telenor.5g4data",
        name: "avalanche-search-v2.control.dsl",
        content: "updated script",
        lastRunMode: "execute",
      },
    });

    const deleteResponse = await routeModule.DELETE(
      new Request("http://localhost/api/scripts/script-1", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ id: "script-1" }),
      },
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
  });
});
