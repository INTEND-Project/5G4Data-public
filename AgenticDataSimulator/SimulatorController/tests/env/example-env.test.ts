import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe(".env.example", () => {
  it("documents the sqlite database path relative to prisma/schema.prisma", () => {
    const source = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

    expect(source).toContain('DATABASE_URL="file:./dev.db"');
    expect(source).toContain("GRAFANA_ADMIN_PASSWORD");
  });
});
