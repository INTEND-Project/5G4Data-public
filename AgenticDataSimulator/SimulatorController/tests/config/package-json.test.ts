import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("binds the dev server to 0.0.0.0 for reverse proxy access", () => {
    const source = readFileSync(resolve(process.cwd(), "package.json"), "utf8");

    expect(source).toContain('"dev": "next dev --turbopack --hostname 0.0.0.0"');
  });
});
