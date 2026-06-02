import { describe, expect, it } from "vitest";

import {
  buildGrafanaDockedMenuBootstrapHtml,
  validateGrafanaOpenTarget,
  wrapGrafanaIntentOpenUrl,
} from "../../src/lib/grafana/open-url";

describe("validateGrafanaOpenTarget", () => {
  const base = "https://start5g-1.cs.uit.no/grafana";

  it("accepts dashboard URLs under the configured Grafana base", () => {
    expect(
      validateGrafanaOpenTarget(
        "https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h",
        base,
      ),
    ).toBe("https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h");
  });

  it("rejects external origins", () => {
    expect(
      validateGrafanaOpenTarget("https://evil.example/grafana/d/abc", base),
    ).toBeNull();
  });

  it("rejects paths outside the Grafana prefix", () => {
    expect(
      validateGrafanaOpenTarget("https://start5g-1.cs.uit.no/tmf-simulator", base),
    ).toBeNull();
  });
});

describe("wrapGrafanaIntentOpenUrl", () => {
  it("wraps validated dashboard URLs through the Controller open route", () => {
    const wrapped = wrapGrafanaIntentOpenUrl(
      "https://start5g-1.cs.uit.no/grafana/d/abc/slug?from=now-3h",
      "/tmf-simulator",
      "https://start5g-1.cs.uit.no/grafana",
    );

    expect(wrapped).toBe(
      "/tmf-simulator/api/grafana/open?to=https%3A%2F%2Fstart5g-1.cs.uit.no%2Fgrafana%2Fd%2Fabc%2Fslug%3Ffrom%3Dnow-3h",
    );
  });

  it("returns the dashboard URL unchanged when it does not match the Grafana base", () => {
    const dashboardUrl = "http://grafana.example:3001/d/abc/slug";
    expect(
      wrapGrafanaIntentOpenUrl(dashboardUrl, "/tmf-simulator", "https://start5g-1.cs.uit.no/grafana"),
    ).toBe(dashboardUrl);
  });
});

describe("buildGrafanaDockedMenuBootstrapHtml", () => {
  it("sets docked menu keys and redirects", () => {
    const html = buildGrafanaDockedMenuBootstrapHtml(
      "https://start5g-1.cs.uit.no/grafana/d/abc/slug",
    );

    expect(html).toContain('localStorage.setItem("grafana.navigation.docked", "true");');
    expect(html).toContain(
      'localStorage.setItem("grafana.ui.sidebar.dashboard-view.docked", "true");',
    );
    expect(html).toContain(
      'location.replace("https://start5g-1.cs.uit.no/grafana/d/abc/slug");',
    );
  });
});
