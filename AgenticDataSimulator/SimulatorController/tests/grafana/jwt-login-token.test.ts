import { describe, expect, it } from "vitest";

import {
  createGrafanaLoginToken,
  parseGrafanaJwtEditorUsers,
  resolveGrafanaJwtOrgRole,
} from "../../src/lib/grafana/jwt-login-token";

describe("createGrafanaLoginToken", () => {
  it("embeds sub and email claims", () => {
    const token = createGrafanaLoginToken({
      username: "arne",
      secret: "test-secret",
      ttlSeconds: 300,
      nowMs: 1_700_000_000_000,
    });

    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub: string;
      email: string;
      exp: number;
    };

    expect(decoded.sub).toBe("arne");
    expect(decoded.email).toBe("arne@simulator.local");
    expect(decoded.exp).toBe(Math.floor(1_700_000_000_000 / 1000) + 300);
  });

  it("adds role Editor for configured editor users", () => {
    const editors = parseGrafanaJwtEditorUsers("arneme, arne");
    expect(resolveGrafanaJwtOrgRole("arneme", editors)).toBe("Editor");
    expect(resolveGrafanaJwtOrgRole("other", editors)).toBeUndefined();

    const token = createGrafanaLoginToken({
      username: "arneme",
      secret: "test-secret",
      orgRole: "Editor",
      nowMs: 1_700_000_000_000,
    });
    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: string;
    };
    expect(decoded.role).toBe("Editor");
  });
});
