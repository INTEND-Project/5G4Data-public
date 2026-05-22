import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("home page", () => {
  it("routes users to login or workspace based on session state", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(source).toContain('redirect("/login")');
    expect(source).toContain('redirect("/workspace")');
  });
});
