import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchIntentMetricCatalog } from "../../src/lib/kg/fetch-intent-metric-catalog-client";

describe("fetchIntentMetricCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns metric names on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          metricNames: ["container_cpu_watts_CO59017927cae243ac8d8cf482f01e922c"],
        }),
      }),
    );

    const result = await fetchIntentMetricCatalog({
      kgTargetsApiBaseUrl: "http://localhost/api/kg-targets",
      kgTargetId: "kg-target-1",
      intentLocalId: "Ia2394317018641f699207402725dfc6a",
    });

    expect(result).toEqual({
      ok: true,
      metricNames: ["container_cpu_watts_CO59017927cae243ac8d8cf482f01e922c"],
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/api/kg-targets/kg-target-1/metric-catalog",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ intentLocalId: "Ia2394317018641f699207402725dfc6a" }),
      }),
    );
  });

  it("returns HTTP error details when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Knowledge graph target not found" }),
      }),
    );

    const result = await fetchIntentMetricCatalog({
      kgTargetsApiBaseUrl: "http://localhost/api/kg-targets/",
      kgTargetId: "missing",
      intentLocalId: "Ia2394317018641f699207402725dfc6a",
    });

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: "Knowledge graph target not found",
    });
  });

  it("returns empty metricNames when body omits metricNames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }),
    );

    const result = await fetchIntentMetricCatalog({
      kgTargetsApiBaseUrl: "http://localhost/api/kg-targets",
      kgTargetId: "kg-target-1",
      intentLocalId: "Ia2394317018641f699207402725dfc6a",
    });

    expect(result).toEqual({ ok: true, metricNames: [] });
  });

  it("returns network error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const result = await fetchIntentMetricCatalog({
      kgTargetsApiBaseUrl: "http://localhost/api/kg-targets",
      kgTargetId: "kg-target-1",
      intentLocalId: "Ia2394317018641f699207402725dfc6a",
    });

    expect(result).toEqual({
      ok: false,
      status: 0,
      error: "connection refused",
    });
  });
});
