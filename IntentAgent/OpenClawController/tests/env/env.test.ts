import { describe, expect, it } from "vitest";

async function loadEnvModule() {
  try {
    return await import("../../src/lib/env");
  } catch (error) {
    return { error };
  }
}

describe("loadAppEnv", () => {
  it("returns documented defaults when optional values are not set", async () => {
    const loaded = await loadEnvModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    const env = loaded.loadAppEnv({
      DATABASE_URL: "file:./dev.db",
    });

    expect(env.databaseUrl).toBe("file:./dev.db");
    expect(env.a2aRegistryBaseUrl).toBe("https://start5g-1.cs.uit.no/a2a-registry");
    expect(env.graphDbBaseUrl).toBe("http://start5g-1.cs.uit.no:7200/");
    expect(env.appBasePath).toBe("/tmf-simulator");
    expect(env.assistantModel).toBe("gpt-4.1-mini");
    expect(env.assistantApiKey).toBeUndefined();
  });

  it("prefers explicit environment overrides", async () => {
    const loaded = await loadEnvModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    const env = loaded.loadAppEnv({
      DATABASE_URL: "file:./test.db",
      A2A_REGISTRY_BASE_URL: "https://registry.example.test",
      GRAPHDB_BASE_URL: "http://graphdb.example.test:7200/",
      APP_BASE_PATH: "/controller",
      ASSISTANT_MODEL: "claude-3-7-sonnet",
      ASSISTANT_API_KEY: "secret",
    });

    expect(env).toMatchObject({
      databaseUrl: "file:./test.db",
      a2aRegistryBaseUrl: "https://registry.example.test",
      graphDbBaseUrl: "http://graphdb.example.test:7200/",
      appBasePath: "/controller",
      assistantModel: "claude-3-7-sonnet",
      assistantApiKey: "secret",
    });
  });
});
