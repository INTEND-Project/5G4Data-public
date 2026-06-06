import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedUser = {
  id: "user-1",
  username: "alice",
};

const listChartsMock = {
  listWorkloadCatalogCharts: vi.fn(),
};

const guardMock = {
  getAuthenticatedUser: vi.fn(),
};

vi.mock("../../src/lib/workload-catalogue/list-charts", () => listChartsMock);
vi.mock("../../src/lib/auth/guards", () => guardMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  guardMock.getAuthenticatedUser.mockResolvedValue(authenticatedUser);
});

describe("workload catalogue charts route", () => {
  it("returns workloads from the catalogue", async () => {
    listChartsMock.listWorkloadCatalogCharts.mockResolvedValue([
      { name: "rusty-llm", version: "0.1.19" },
    ]);

    const routeModule = await import("../../src/app/api/workload-catalogue/charts/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/workload-catalogue/charts"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workloads: [{ name: "rusty-llm", version: "0.1.19" }],
    });
    expect(listChartsMock.listWorkloadCatalogCharts).toHaveBeenCalledWith(undefined);
  });

  it("returns 502 when catalogue listing fails", async () => {
    listChartsMock.listWorkloadCatalogCharts.mockRejectedValue(
      new Error("Workload catalogue request failed (503)."),
    );

    const routeModule = await import("../../src/app/api/workload-catalogue/charts/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/workload-catalogue/charts"),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Workload catalogue request failed (503).",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    guardMock.getAuthenticatedUser.mockResolvedValue(null);

    const routeModule = await import("../../src/app/api/workload-catalogue/charts/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/workload-catalogue/charts"),
    );

    expect(response.status).toBe(401);
  });
});
