import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("graphdb status", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example",
      GRAPHDB_BASE_URL: "http://graphdb.example/",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("returns true when the GraphDB repositories endpoint is reachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const graphDbStatusModule = await import("../../src/lib/graphdb/status");

    await expect(graphDbStatusModule.getGraphDbConnectionStatus()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("http://graphdb.example/rest/repositories", {
      cache: "no-store",
      headers: {},
    });
  });

  it("returns false when the GraphDB repositories endpoint is not reachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    vi.stubGlobal("fetch", fetchMock);

    const graphDbStatusModule = await import("../../src/lib/graphdb/status");

    await expect(graphDbStatusModule.getGraphDbConnectionStatus()).resolves.toBe(false);
  });
});
