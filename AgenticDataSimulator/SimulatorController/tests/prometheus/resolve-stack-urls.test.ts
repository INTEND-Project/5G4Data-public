import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("resolve-stack-urls", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example",
      GRAPHDB_BASE_URL: "http://graphdb.example/",
      PROMETHEUS_URL: "https://start5g-1.cs.uit.no/prometheus",
      PUSHGATEWAY_URL: "https://start5g-1.cs.uit.no/prometheus-pushgateway",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("treats the server-configured Prometheus URL as the managed lab stack", async () => {
    const { isLocalPrometheusStack, prometheusStackMode } = await import(
      "../../src/lib/prometheus/resolve-stack-urls"
    );

    expect(isLocalPrometheusStack("https://start5g-1.cs.uit.no/prometheus")).toBe(true);
    expect(isLocalPrometheusStack("https://start5g-1.cs.uit.no/prometheus/")).toBe(true);
    expect(prometheusStackMode("https://start5g-1.cs.uit.no/prometheus")).toBe("local");
  });

  it("treats loopback Prometheus URLs as the managed lab stack", async () => {
    process.env.PROMETHEUS_URL = "http://127.0.0.1:9090";

    const { isLocalPrometheusStack } = await import("../../src/lib/prometheus/resolve-stack-urls");

    expect(isLocalPrometheusStack("http://127.0.0.1:9090")).toBe(true);
    expect(isLocalPrometheusStack("http://localhost:9090/")).toBe(true);
  });

  it("treats partner Prometheus URLs as external when they differ from server default", async () => {
    const { isLocalPrometheusStack, prometheusStackMode } = await import(
      "../../src/lib/prometheus/resolve-stack-urls"
    );

    expect(isLocalPrometheusStack("https://partner.example/prometheus")).toBe(false);
    expect(prometheusStackMode("https://partner.example/prometheus")).toBe("external");
  });
});
