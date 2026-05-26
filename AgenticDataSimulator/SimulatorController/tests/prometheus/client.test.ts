import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const canonicalIntentId = "I04fb0697e3a243e7a292c6cb57e9f797";

describe("prometheus client", () => {
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

  it("lists intent ids from Prometheus label values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: [canonicalIntentId, "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const prometheusClientModule = await import("../../src/lib/prometheus/client");

    await expect(prometheusClientModule.listIntentIds()).resolves.toEqual([
      canonicalIntentId,
      "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://prometheus.example:9090/api/v1/label/intent_id/values",
      { cache: "no-store" },
    );
  });

  it("clears Pushgateway group and Prometheus TSDB series for an intent", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? "GET";

      if (
        method === "DELETE" &&
        url ===
          `http://pushgateway.example:9091/metrics/job/intent_reports/intent_id/${encodeURIComponent(canonicalIntentId)}`
      ) {
        return new Response(null, { status: 202 });
      }

      if (method === "POST" && url.includes("/api/v1/admin/tsdb/delete_series")) {
        expect(url).toContain(
          encodeURIComponent(`{intent_id="${canonicalIntentId}"}`),
        );
        return new Response(null, { status: 204 });
      }

      if (method === "POST" && url.endsWith("/api/v1/admin/tsdb/clean_tombstones")) {
        return new Response(null, { status: 200 });
      }

      return new Response(null, { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const prometheusClientModule = await import("../../src/lib/prometheus/client");

    await expect(prometheusClientModule.clearIntentMetrics(canonicalIntentId)).resolves.toEqual({
      intentId: canonicalIntentId,
      pushgatewayCleared: true,
      tsdbSeriesDeleted: true,
      tombstonesCleaned: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid intent ids", async () => {
    const prometheusClientModule = await import("../../src/lib/prometheus/client");

    await expect(prometheusClientModule.clearIntentMetrics("not-an-intent")).rejects.toThrow(
      "intentId must be canonical I + 32 hex characters",
    );
  });
});
