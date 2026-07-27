import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const workloadCatalogStatusMock = {
  getWorkloadCatalogConnectionStatus: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/workload-catalogue/status", () => workloadCatalogStatusMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("workload catalogue status route", () => {
  it("returns connection status for the requested catalogue URL", async () => {
    workloadCatalogStatusMock.getWorkloadCatalogConnectionStatus.mockResolvedValue(true);

    const routeModule = await import("../../src/app/api/workload-catalogue/status/route");
    const response = await routeModule.GET(
      new Request(
        "http://localhost/api/workload-catalogue/status?workloadCatalogBaseUrl=https%3A%2F%2Fcatalog.example",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: true });
    expect(workloadCatalogStatusMock.getWorkloadCatalogConnectionStatus).toHaveBeenCalledWith(
      "https://catalog.example",
    );
  });

  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/workload-catalogue/status/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/workload-catalogue/status"),
    );

    expect(response.status).toBe(401);
  });
});
