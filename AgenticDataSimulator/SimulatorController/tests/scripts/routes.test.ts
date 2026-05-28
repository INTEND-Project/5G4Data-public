import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

function scriptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "script-1",
    userId: "user-1",
    domain: "telenor.5g4data",
    name: "avalanche-search.control.dsl",
    content: "discover intent-agent by domain 5g4data as intentGen",
    shared: false,
    lastRunMode: "dry-run",
    user: { username: "alice" },
    ...overrides,
  };
}

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
    dbMock.script.findMany.mockResolvedValue([scriptRow()]);

    const routeModule = await import("../../src/app/api/scripts/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/scripts?domain=telenor.5g4data"),
    );

    expect(response.status).toBe(200);
    expect(dbMock.script.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          domain: "telenor.5g4data",
          OR: [{ userId: "user-1" }, { shared: true }],
        },
      }),
    );
    await expect(response.json()).resolves.toEqual({
      scripts: [
        {
          id: "script-1",
          userId: "user-1",
          domain: "telenor.5g4data",
          name: "avalanche-search.control.dsl",
          content: "discover intent-agent by domain 5g4data as intentGen",
          shared: false,
          lastRunMode: "dry-run",
          ownerUsername: "alice",
        },
      ],
    });
  });

  it("creates a script for the authenticated user", async () => {
    dbMock.script.create.mockResolvedValue(scriptRow({ lastRunMode: null, content: "" }));

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
        shared: false,
        lastRunMode: null,
        ownerUsername: "alice",
      },
    });
  });

  it("creates a shared script with shared- prefix from nameSuffix", async () => {
    dbMock.script.create.mockResolvedValue(
      scriptRow({
        name: "shared-foo.dsl",
        shared: true,
        content: "shared body",
      }),
    );

    const routeModule = await import("../../src/app/api/scripts/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/scripts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          nameSuffix: "foo.dsl",
          content: "shared body",
          shared: true,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(dbMock.script.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "shared-foo.dsl",
          shared: true,
        }),
      }),
    );
  });

  it("returns 400 when shared script suffix is empty", async () => {
    const routeModule = await import("../../src/app/api/scripts/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/scripts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: "telenor.5g4data",
          nameSuffix: "   ",
          content: "shared body",
          shared: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns a specific script only when it belongs to the authenticated user", async () => {
    dbMock.script.findFirst.mockResolvedValue(scriptRow());

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
        shared: false,
        lastRunMode: "dry-run",
        ownerUsername: "alice",
      },
    });
  });

  it("updates and deletes a user-owned script", async () => {
    dbMock.script.findFirst.mockResolvedValue(
      scriptRow({ content: "draft", lastRunMode: null }),
    );
    dbMock.script.update.mockResolvedValue(
      scriptRow({
        name: "avalanche-search-v2.control.dsl",
        content: "updated script",
        lastRunMode: "execute",
      }),
    );
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
        shared: false,
        lastRunMode: "execute",
        ownerUsername: "alice",
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

  it("returns 403 when a non-owner patches a script", async () => {
    dbMock.script.findFirst.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/scripts/[id]/route");
    const response = await routeModule.PATCH(
      new Request("http://localhost/api/scripts/script-2", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content: "nope",
        }),
      }),
      {
        params: Promise.resolve({ id: "script-2" }),
      },
    );

    expect(response.status).toBe(403);
  });
});
