import { beforeEach, describe, expect, it, vi } from "vitest";

const graphDbStatusMock = vi.fn();
const prometheusStatusMock = vi.fn();
const registryStatusMock = vi.fn();

vi.mock("../../src/lib/graphdb/status", () => ({
  getGraphDbConnectionStatus: graphDbStatusMock,
}));

vi.mock("../../src/lib/prometheus/status", () => ({
  getPrometheusConnectionStatus: prometheusStatusMock,
}));

vi.mock("../../src/lib/registry/status", () => ({
  getRegistryConnectionStatus: registryStatusMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("infra connection status", () => {
  it("aggregates registry, GraphDB, and Prometheus status helpers", async () => {
    registryStatusMock.mockResolvedValue(true);
    graphDbStatusMock.mockResolvedValue(false);
    prometheusStatusMock.mockResolvedValue(true);

    const connectionStatusModule = await import("../../src/lib/infra/connection-status");

    await expect(connectionStatusModule.getInfraConnectionStatus()).resolves.toEqual({
      registryConnected: true,
      graphDbConnected: false,
      prometheusConnected: true,
    });
  });
});
