import { describe, expect, it } from "vitest";

import {
  stripGrafanaAuthToken,
  withFreshGrafanaAuthToken,
} from "../../src/lib/grafana/grafana-auth-url";
import { createGrafanaLoginToken } from "../../src/lib/grafana/jwt-login-token";

describe("stripGrafanaAuthToken", () => {
  it("removes auth_token from dashboard URLs", () => {
    expect(
      stripGrafanaAuthToken(
        "https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h&auth_token=old",
      ),
    ).toBe("https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h");
  });
});

describe("withFreshGrafanaAuthToken", () => {
  it("appends auth_token when login username and jwt secret are configured", () => {
    const url = withFreshGrafanaAuthToken(
      "https://start5g-1.cs.uit.no/grafana/d/abc/slug?var-intent_id=Iintent123456789012345678901234567890",
      "arne",
      {
        DATABASE_URL: "file:./dev.db",
        GRAFANA_JWT_SECRET: "jwt-test-secret",
        GRAFANA_JWT_TTL_SECONDS: "120",
      },
    );

    expect(url).toContain("auth_token=");
    expect(url).toContain("var-intent_id=Iintent123456789012345678901234567890");
    expect(url).not.toContain("auth_token=old");
  });

  it("replaces an existing auth_token with a newly minted one", () => {
    const stale = createGrafanaLoginToken({
      username: "arne",
      secret: "old-secret",
      nowMs: 1_700_000_000_000,
    });

    const url = withFreshGrafanaAuthToken(
      `https://start5g-1.cs.uit.no/grafana/d/abc/slug?auth_token=${stale}`,
      "arne",
      {
        DATABASE_URL: "file:./dev.db",
        GRAFANA_JWT_SECRET: "jwt-test-secret",
      },
    );

    expect(url).toContain("auth_token=");
    expect(url).not.toContain(stale);
  });

  it("returns the URL without auth_token when username is missing", () => {
    expect(
      withFreshGrafanaAuthToken(
        "https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h",
        null,
        {
          DATABASE_URL: "file:./dev.db",
          GRAFANA_JWT_SECRET: "jwt-test-secret",
        },
      ),
    ).toBe("https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h");
  });
});
