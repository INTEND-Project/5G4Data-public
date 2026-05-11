import { describe, expect, it } from "vitest";

describe("app path helpers", () => {
  it("uses a configurable base path with a tmf simulator default", async () => {
    const routeModule = await import("../../src/lib/app-paths");

    expect(routeModule.getConfiguredAppBasePath({})).toBe("/tmf-simulator");
    expect(routeModule.getConfiguredAppBasePath({ APP_BASE_PATH: "/controller" })).toBe(
      "/controller",
    );
    expect(routeModule.APP_BASE_PATH).toBe("/tmf-simulator");
    expect(routeModule.withAppBasePath("/login")).toBe("/tmf-simulator/login");
    expect(routeModule.withAppBasePath("/login", "/controller")).toBe("/controller/login");
    expect(routeModule.withAppBasePath("/api/auth/register")).toBe(
      "/tmf-simulator/api/auth/register",
    );
    expect(
      routeModule.buildAppUrl(new Request("https://start5g-1.cs.uit.no/tmf-simulator/login"), "/workspace")
        .toString(),
    ).toBe("https://start5g-1.cs.uit.no/tmf-simulator/workspace");
  });
});
