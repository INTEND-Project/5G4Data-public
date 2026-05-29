import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("next config", () => {
  it("derives the Simulator Controller base path from configuration", () => {
    const source = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

    expect(source).toContain("getConfiguredAppBasePath(process.env)");
    expect(source).toContain('allowedDevOrigins: ["start5g-1.cs.uit.no"]');
    expect(source).toContain('distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next"');
  });
});
