import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
};

const passwordMock = {
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
};

const sessionMock = {
  SESSION_COOKIE_NAME: "openclaw-controller-session",
  createSessionToken: vi.fn(),
  createSessionExpiry: vi.fn(),
  createSessionCookie: vi.fn(),
  createClearedSessionCookie: vi.fn(),
  hashSessionToken: vi.fn(),
};

vi.mock("../../src/lib/db", () => ({
  db: dbMock,
}));

vi.mock("../../src/lib/auth/password", () => passwordMock);

vi.mock("../../src/lib/auth/session", () => sessionMock);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  sessionMock.createSessionToken.mockReturnValue("session-token");
  sessionMock.createSessionExpiry.mockReturnValue(new Date("2030-01-01T00:00:00.000Z"));
  sessionMock.hashSessionToken.mockImplementation((token: string) => `hashed:${token}`);
  sessionMock.createSessionCookie.mockImplementation((value: string, secure: boolean) => ({
    name: "openclaw-controller-session",
    value,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure,
      maxAge: 604800,
    },
  }));
  sessionMock.createClearedSessionCookie.mockImplementation((secure: boolean) => ({
    name: "openclaw-controller-session",
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure,
      maxAge: 0,
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth route handlers", () => {
  it("registers a user from a browser form post and redirects to workspace", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    passwordMock.hashPassword.mockResolvedValue("hashed-password");
    dbMock.user.create.mockResolvedValue({
      id: "user-1",
      username: "alice",
    });
    dbMock.session.create.mockResolvedValue({
      id: "session-1",
    });

    const routeModule = await import("../../src/app/api/auth/register/route");
    const response = await routeModule.POST(
      new Request("http://localhost/tmf-simulator/api/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: "alice",
          password: "secret-password",
        }),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/tmf-simulator/workspace");
    expect(response.headers.get("set-cookie")).toContain(
      "openclaw-controller-session=session-token",
    );
  });

  it("registers a user and sets a session cookie", async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    passwordMock.hashPassword.mockResolvedValue("hashed-password");
    dbMock.user.create.mockResolvedValue({
      id: "user-1",
      username: "alice",
    });
    dbMock.session.create.mockResolvedValue({
      id: "session-1",
    });

    const routeModule = await import("../../src/app/api/auth/register/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "alice",
          password: "secret-password",
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        username: "alice",
      },
    });
    expect(response.headers.get("set-cookie")).toContain(
      "openclaw-controller-session=session-token",
    );
  });

  it("logs in an existing user from a browser form post and redirects to workspace", async () => {
    dbMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "alice",
      passwordHash: "stored-hash",
    });
    passwordMock.verifyPassword.mockResolvedValue(true);
    dbMock.session.create.mockResolvedValue({
      id: "session-1",
    });

    const routeModule = await import("../../src/app/api/auth/login/route");
    const response = await routeModule.POST(
      new Request("http://localhost/tmf-simulator/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          username: "alice",
          password: "secret-password",
        }),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/tmf-simulator/workspace");
    expect(response.headers.get("set-cookie")).toContain(
      "openclaw-controller-session=session-token",
    );
  });

  it("logs in an existing user and sets a session cookie", async () => {
    dbMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "alice",
      passwordHash: "stored-hash",
    });
    passwordMock.verifyPassword.mockResolvedValue(true);
    dbMock.session.create.mockResolvedValue({
      id: "session-1",
    });

    const routeModule = await import("../../src/app/api/auth/login/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: "alice",
          password: "secret-password",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "user-1",
        username: "alice",
      },
    });
    expect(response.headers.get("set-cookie")).toContain(
      "openclaw-controller-session=session-token",
    );
  });

  it("returns the authenticated session user when a valid cookie is present", async () => {
    dbMock.session.findUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      user: {
        id: "user-1",
        username: "alice",
      },
    });

    const routeModule = await import("../../src/app/api/auth/session/route");
    const response = await routeModule.GET(
      new Request("http://localhost/api/auth/session", {
        headers: {
          cookie: "openclaw-controller-session=session-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      user: {
        id: "user-1",
        username: "alice",
      },
    });
  });

  it("clears the current session on logout", async () => {
    dbMock.session.deleteMany.mockResolvedValue({
      count: 1,
    });

    const routeModule = await import("../../src/app/api/auth/logout/route");
    const response = await routeModule.POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: "openclaw-controller-session=session-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
