import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("prometheus status", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example",
      GRAPHDB_BASE_URL: "http://graphdb.example/",
      PROMETHEUS_URL: "http://prometheus.example:9090/",
      PUSHGATEWAY_URL: "http://pushgateway.example:9091",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("returns true when the Prometheus health endpoint is reachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const prometheusStatusModule = await import("../../src/lib/prometheus/status");

    await expect(prometheusStatusModule.getPrometheusConnectionStatus()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://prometheus.example:9090/-/healthy", {
      cache: "no-store",
    });
  });

  it("returns false when the Prometheus health endpoint is not reachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    vi.stubGlobal("fetch", fetchMock);

    const prometheusStatusModule = await import("../../src/lib/prometheus/status");

    await expect(prometheusStatusModule.getPrometheusConnectionStatus()).resolves.toBe(false);
  });
});
