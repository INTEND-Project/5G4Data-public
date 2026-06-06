import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const infraStatusMock = {
  getInfraConnectionStatus: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/infra/connection-status", () => infraStatusMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("infra status route", () => {
  it("returns aggregated connection status for authenticated users", async () => {
    infraStatusMock.getInfraConnectionStatus.mockResolvedValue({
      registryConnected: true,
      graphDbConnected: false,
      prometheusConnected: true,
      workloadCatalogConnected: true,
    });

    const routeModule = await import("../../src/app/api/infra/status/route");
    const response = await routeModule.GET(new Request("http://localhost/api/infra/status"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      registryConnected: true,
      graphDbConnected: false,
      prometheusConnected: true,
      workloadCatalogConnected: true,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/infra/status/route");
    const response = await routeModule.GET(new Request("http://localhost/api/infra/status"));

    expect(response.status).toBe(401);
  });
});
