import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("resolvePrometheusBaseUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example",
      GRAPHDB_BASE_URL: "http://graphdb.example/",
      PROMETHEUS_URL: "http://prometheus.example:9090/prometheus/",
      PUSHGATEWAY_URL: "http://pushgateway.example:9091",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses the server default when override is empty", async () => {
    const mod = await import("../../src/lib/prometheus/resolve-base-url");
    expect(mod.resolvePrometheusBaseUrl()).toBe("http://prometheus.example:9090/prometheus/");
    expect(mod.resolvePrometheusBaseUrl("   ")).toBe("http://prometheus.example:9090/prometheus/");
  });

  it("normalizes a user override with trailing slash", async () => {
    const mod = await import("../../src/lib/prometheus/resolve-base-url");
    expect(mod.resolvePrometheusBaseUrl("http://partner.example:9090/")).toBe(
      "http://partner.example:9090/",
    );
  });

  it("parsePrometheusBaseUrlInput returns validation errors for invalid URLs", async () => {
    const mod = await import("../../src/lib/prometheus/resolve-base-url");
    const parsed = mod.parsePrometheusBaseUrlInput("not-a-url");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.length).toBeGreaterThan(0);
    }
  });
});
