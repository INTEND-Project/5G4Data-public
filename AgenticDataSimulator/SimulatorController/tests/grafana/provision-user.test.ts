import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { grafanaEmailForLogin } from "../../src/lib/grafana/provision-user";

const originalEnv = { ...process.env };

describe("grafanaEmailForLogin", () => {
  it("uses login as email when it already contains @", () => {
    expect(grafanaEmailForLogin("a.speranza@nextworks.it", "simulator.local")).toBe(
      "a.speranza@nextworks.it",
    );
  });

  it("appends domain for plain usernames", () => {
    expect(grafanaEmailForLogin("arne", "simulator.local")).toBe("arne@simulator.local");
  });
});

describe("provisionGrafanaUser", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      DATABASE_URL: "file:./dev.db",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("skips provisioning when grafana admin password is unset", async () => {
    process.env.GRAFANA_BASE_URL = "http://grafana.example:3002";

    const module = await import("../../src/lib/grafana/provision-user");

    await expect(
      module.provisionGrafanaUser({
        login: "alice",
        password: "secret-password",
      }),
    ).resolves.toEqual({ provisioned: false });
  });

  it("creates a grafana user with basic auth", async () => {
    process.env.GRAFANA_BASE_URL = "http://grafana.example:3002";
    process.env.GRAFANA_ADMIN_PASSWORD = "admin-secret";
    process.env.GRAFANA_ADMIN_USER = "admin";
    process.env.GRAFANA_ORG_ID = "1";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 42, message: "User created" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const module = await import("../../src/lib/grafana/provision-user");

    await expect(
      module.provisionGrafanaUser({
        login: "alice",
        password: "secret-password",
      }),
    ).resolves.toEqual({
      provisioned: true,
      userId: 42,
      syncedExistingPassword: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://grafana.example:3002/api/admin/users");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("admin:admin-secret", "utf8").toString("base64")}`,
    );
    expect(JSON.parse(String(init.body))).toEqual({
      name: "alice",
      email: "alice@simulator.local",
      login: "alice",
      password: "secret-password",
      OrgId: 1,
    });
  });

  it("syncs password when grafana reports the user already exists", async () => {
    process.env.GRAFANA_BASE_URL = "http://grafana.example:3002";
    process.env.GRAFANA_ADMIN_PASSWORD = "admin-secret";

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";

      if (method === "POST" && url.endsWith("/api/admin/users")) {
        return new Response(
          JSON.stringify({
            message: "User with email 'alice@simulator.local' or username 'alice' already exists",
          }),
          { status: 412 },
        );
      }

      if (method === "GET" && url.includes("/api/users/lookup")) {
        return new Response(JSON.stringify({ id: 7, login: "alice" }), { status: 200 });
      }

      if (method === "PUT" && url.endsWith("/api/admin/users/7/password")) {
        return new Response(JSON.stringify({ message: "User password updated" }), { status: 200 });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const module = await import("../../src/lib/grafana/provision-user");

    await expect(
      module.provisionGrafanaUser({
        login: "alice",
        password: "secret-password",
      }),
    ).resolves.toEqual({
      provisioned: true,
      userId: 7,
      syncedExistingPassword: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("skips password sync when onExisting is skip", async () => {
    process.env.GRAFANA_BASE_URL = "http://grafana.example:3002";
    process.env.GRAFANA_ADMIN_PASSWORD = "admin-secret";

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";

      if (method === "POST" && url.endsWith("/api/admin/users")) {
        return new Response(JSON.stringify({ message: "already exists" }), { status: 412 });
      }

      if (method === "GET" && url.includes("/api/users/lookup")) {
        return new Response(JSON.stringify({ id: 3, login: "alice" }), { status: 200 });
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const module = await import("../../src/lib/grafana/provision-user");

    await expect(
      module.provisionGrafanaUser(
        { login: "alice", password: "secret-password" },
        { onExisting: "skip" },
      ),
    ).resolves.toEqual({
      provisioned: false,
      userId: 3,
      syncedExistingPassword: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when grafana create fails with a non-412 status", async () => {
    process.env.GRAFANA_BASE_URL = "http://grafana.example:3002";
    process.env.GRAFANA_ADMIN_PASSWORD = "admin-secret";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }),
      ),
    );

    const module = await import("../../src/lib/grafana/provision-user");

    await expect(
      module.provisionGrafanaUser({
        login: "alice",
        password: "secret-password",
      }),
    ).rejects.toMatchObject({
      name: "GrafanaProvisioningError",
      message: "Unauthorized",
      statusCode: 401,
    });
  });
});
