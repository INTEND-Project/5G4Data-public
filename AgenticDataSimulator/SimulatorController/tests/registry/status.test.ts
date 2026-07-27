import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("registry status", () => {
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

  it("returns true when the registry agents endpoint is reachable even if the root URL is not", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://registry.example/api/agents") {
        return new Response(JSON.stringify({ agents: [] }), { status: 200 });
      }

      return new Response(null, { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const registryStatusModule = await import("../../src/lib/registry/status");

    await expect(registryStatusModule.getRegistryConnectionStatus()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://registry.example/api/agents", {
      cache: "no-store",
    });
  });

  it("returns false when no registry agents endpoint is reachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    vi.stubGlobal("fetch", fetchMock);

    const registryStatusModule = await import("../../src/lib/registry/status");

    await expect(registryStatusModule.getRegistryConnectionStatus()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
