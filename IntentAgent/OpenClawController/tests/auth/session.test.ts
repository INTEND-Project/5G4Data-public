import { describe, expect, it } from "vitest";

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
      name: "openclaw-controller-session",
      value: "session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    });

    expect(cookie.options.maxAge).toBe(60 * 60 * 24 * 7);
  });
});
