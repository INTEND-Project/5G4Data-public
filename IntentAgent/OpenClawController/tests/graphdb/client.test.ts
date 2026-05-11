import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("graphdb client", () => {
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

  it("creates repositories with a GraphDB config upload payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));

    vi.stubGlobal("fetch", fetchMock);

    const graphDbClientModule = await import("../../src/lib/graphdb/client");

    await graphDbClientModule.createRepository({
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
      label: "kg-avalanche-demo",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("http://graphdb.example/rest/repositories");
    expect(init.method).toBe("POST");
    expect(init.headers).not.toEqual({
      "content-type": "application/json",
    });
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    const config = body.get("config");

    expect(config).toBeInstanceOf(File);
    expect((config as File).name).toBe("repo-config.ttl");
    const configText = await (config as File).text();
    expect(configText).toContain('rep:repositoryID "telenor-5g4data-kg-avalanche-demo"');
    expect(configText).toContain('rdfs:label "kg-avalanche-demo"');
    expect(configText).toContain('rep:repositoryType "graphdb:SailRepository"');
  });

  it("throws when GraphDB rejects repository creation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "broken" }), { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    const graphDbClientModule = await import("../../src/lib/graphdb/client");

    await expect(
      graphDbClientModule.createRepository({
        repositoryId: "telenor-5g4data-kg-avalanche-demo",
        label: "kg-avalanche-demo",
      }),
    ).rejects.toThrow("GraphDB repository creation failed with 500");
  });

  it("deletes repositories through the GraphDB REST API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const graphDbClientModule = await import("../../src/lib/graphdb/client");

    await graphDbClientModule.deleteRepository({
      repositoryId: "telenor-5g4data-kg-avalanche-demo",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://graphdb.example/rest/repositories/telenor-5g4data-kg-avalanche-demo",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("throws when GraphDB rejects repository deletion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "broken" }), { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    const graphDbClientModule = await import("../../src/lib/graphdb/client");

    await expect(
      graphDbClientModule.deleteRepository({
        repositoryId: "telenor-5g4data-kg-avalanche-demo",
      }),
    ).rejects.toThrow("GraphDB repository deletion failed with 500");
  });
});
