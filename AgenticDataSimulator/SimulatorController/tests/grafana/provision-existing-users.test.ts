import { describe, expect, it } from "vitest";

import {
  loadExistingUserPasswordSource,
  parseCredentialsEnvFile,
  resolvePasswordForUsername,
} from "../../src/lib/grafana/provision-existing-users";

describe("provision-existing-users", () => {
  it("parses credentials env file lines", () => {
    const map = parseCredentialsEnvFile(`
# comment
arne=secret-one
arneme=secret-two
`);

    expect(map.get("arne")).toBe("secret-one");
    expect(map.get("arneme")).toBe("secret-two");
  });

  it("resolves per-user password before default", () => {
    const source = loadExistingUserPasswordSource({
      defaultPassword: "shared",
      credentialsFile: undefined,
    });
    source.passwordsByUsername.set("arne", "custom");

    expect(resolvePasswordForUsername("arne", source)).toBe("custom");
    expect(resolvePasswordForUsername("bob", source)).toBe("shared");
    expect(resolvePasswordForUsername("missing", { ...source, defaultPassword: undefined })).toBeNull();
  });
});
