import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadSessionModule() {
  try {
    return await import("../../src/lib/auth/session");
  } catch (error) {
    return { error };
  }
}

describe("session helpers", () => {
  it("creates stable storage hashes for session tokens", async () => {
    const loaded = await loadSessionModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    const token = loaded.createSessionToken();
    const secondToken = loaded.createSessionToken();

    expect(token).not.toBe(secondToken);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(loaded.hashSessionToken(token)).toHaveLength(64);
    expect(loaded.hashSessionToken(token)).toBe(loaded.hashSessionToken(token));
  });

  it("returns secure cookie settings for auth sessions", async () => {
    const loaded = await loadSessionModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    const cookie = loaded.createSessionCookie("session-token", false);

    expect(cookie).toMatchObject({
      name: "openclaw-controller-session-tmf-simulator",
      value: "session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/tmf-simulator",
        secure: false,
      },
    });

    expect(cookie.options.maxAge).toBe(60 * 60 * 24 * 7);
  });

  it("scopes cookie name and path to the dev lab base path", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_BASE_PATH", "/tmf-simulator-dev");
    vi.resetModules();

    const loaded = await loadSessionModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    expect(loaded.getSessionCookieName("/tmf-simulator-dev")).toBe(
      "openclaw-controller-session-tmf-simulator-dev",
    );
    expect(loaded.sessionCookiePath("/tmf-simulator-dev")).toBe("/tmf-simulator-dev");

    const cookie = loaded.createSessionCookie("session-token", true);

    expect(cookie.name).toBe("openclaw-controller-session-tmf-simulator-dev");
    expect(cookie.options.path).toBe("/tmf-simulator-dev");
  });
});
