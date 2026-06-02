import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const graphDbStatusMock = {
  getGraphDbConnectionStatus: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/graphdb/status", () => graphDbStatusMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("graphdb status route", () => {
  it("returns connection status using server-side credentials", async () => {
    graphDbStatusMock.getGraphDbConnectionStatus.mockResolvedValue(true);

    const routeModule = await import("../../src/app/api/graphdb/status/route");
    const response = await routeModule.GET(
      new Request(
        "http://localhost/api/graphdb/status?graphDbBaseUrl=http%3A%2F%2Fpartner.example%3A7200%2F",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: true });
    expect(graphDbStatusMock.getGraphDbConnectionStatus).toHaveBeenCalledWith(
      "http://partner.example:7200/",
    );
  });

  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/graphdb/status/route");
    const response = await routeModule.GET(new Request("http://localhost/api/graphdb/status"));

    expect(response.status).toBe(401);
  });
});
