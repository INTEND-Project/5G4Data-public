import { describe, expect, it } from "vitest";

async function loadPasswordModule() {
  try {
    return await import("../../src/lib/auth/password");
  } catch (error) {
    return { error };
  }
}

describe("password auth helpers", () => {
  it("hashes and verifies a password", async () => {
    const loaded = await loadPasswordModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    const password = "correct horse battery staple";
    const hash = await loaded.hashPassword(password);

    expect(hash).not.toBe(password);
    await expect(loaded.verifyPassword(password, hash)).resolves.toBe(true);
    await expect(loaded.verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
