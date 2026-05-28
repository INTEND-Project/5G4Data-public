import { describe, expect, it } from "vitest";

import { createGrafanaLoginToken } from "../../src/lib/grafana/jwt-login-token";
import { buildIntentGrafanaUrl } from "../../src/lib/grafana/intent-dashboard-url";

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
});

describe("buildIntentGrafanaUrl JWT", () => {
  it("appends auth_token when login username and jwt secret are configured", () => {
    const url = buildIntentGrafanaUrl({
      intentId: "Iintent123456789012345678901234567890",
      conditionMetrics: [],
      bounds: null,
      env: {
        baseUrl: "http://grafana.example:3002",
        dashboardUid: "uid",
        dashboardSlug: "slug",
      },
      loginUsername: "arne",
      envSource: {
        DATABASE_URL: "file:./dev.db",
        GRAFANA_JWT_SECRET: "jwt-test-secret",
        GRAFANA_JWT_TTL_SECONDS: "120",
      },
    });

    expect(url).toContain("auth_token=");
    expect(url).toContain("var-intent_id=Iintent123456789012345678901234567890");
  });
});
