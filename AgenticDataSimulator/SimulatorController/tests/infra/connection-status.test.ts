import { beforeEach, describe, expect, it, vi } from "vitest";

const graphDbStatusMock = vi.fn();
const prometheusStatusMock = vi.fn();
const registryStatusMock = vi.fn();
const workloadCatalogStatusMock = vi.fn();

vi.mock("../../src/lib/graphdb/status", () => ({
  getGraphDbConnectionStatus: graphDbStatusMock,
}));

vi.mock("../../src/lib/prometheus/status", () => ({
  getPrometheusConnectionStatus: prometheusStatusMock,
}));

vi.mock("../../src/lib/registry/status", () => ({
  getRegistryConnectionStatus: registryStatusMock,
}));

vi.mock("../../src/lib/workload-catalogue/status", () => ({
  getWorkloadCatalogConnectionStatus: workloadCatalogStatusMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("infra connection status", () => {
  it("aggregates registry, GraphDB, Prometheus, and workload catalogue status helpers", async () => {
    registryStatusMock.mockResolvedValue(true);
    graphDbStatusMock.mockResolvedValue(false);
    prometheusStatusMock.mockResolvedValue(true);
    workloadCatalogStatusMock.mockResolvedValue(false);

    const connectionStatusModule = await import("../../src/lib/infra/connection-status");

    await expect(connectionStatusModule.getInfraConnectionStatus()).resolves.toEqual({
      registryConnected: true,
      graphDbConnected: false,
      prometheusConnected: true,
      workloadCatalogConnected: false,
    });
  });

  it("reuses cached status within the TTL", async () => {
    registryStatusMock.mockResolvedValue(true);
    graphDbStatusMock.mockResolvedValue(true);
    prometheusStatusMock.mockResolvedValue(true);
    workloadCatalogStatusMock.mockResolvedValue(true);

    const connectionStatusModule = await import("../../src/lib/infra/connection-status");

    await connectionStatusModule.getInfraConnectionStatus();
    await connectionStatusModule.getInfraConnectionStatus();

    expect(registryStatusMock).toHaveBeenCalledTimes(1);
    expect(graphDbStatusMock).toHaveBeenCalledTimes(1);
    expect(prometheusStatusMock).toHaveBeenCalledTimes(1);
    expect(workloadCatalogStatusMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when forceRefresh is set", async () => {
    registryStatusMock.mockResolvedValue(true);
    graphDbStatusMock.mockResolvedValue(true);
    prometheusStatusMock.mockResolvedValue(true);
    workloadCatalogStatusMock.mockResolvedValue(true);

    const connectionStatusModule = await import("../../src/lib/infra/connection-status");

    await connectionStatusModule.getInfraConnectionStatus();
    await connectionStatusModule.getInfraConnectionStatus({ forceRefresh: true });

    expect(registryStatusMock).toHaveBeenCalledTimes(2);
  });
});
