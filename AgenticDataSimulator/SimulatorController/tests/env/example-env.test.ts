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

describe(".env.dev.example", () => {
  it("documents dev lab database and base path", () => {
    const source = readFileSync(resolve(process.cwd(), ".env.dev.example"), "utf8");

    expect(source).toContain('DATABASE_URL="file:./dev-lab.db"');
    expect(source).toContain('APP_BASE_PATH="/tmf-simulator-dev"');
  });
});
