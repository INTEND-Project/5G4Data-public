import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Prisma bootstrap schema", () => {
  it("defines a sqlite datasource and a generated client output", () => {
    const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");

    let schema: string | undefined;

    try {
      schema = readFileSync(schemaPath, "utf8");
    } catch (error) {
      expect(error).toBeUndefined();
      return;
    }

    expect(schema).toContain('provider = "sqlite"');
    expect(schema).toContain('url      = env("DATABASE_URL")');
    expect(schema).toContain('provider = "prisma-client-js"');
    expect(schema).toContain("model User");
    expect(schema).toContain("model Session");
    expect(schema).toContain("model Script");
    expect(schema).toContain("model KnowledgeGraphTarget");
    expect(schema).toContain("model ScriptRun");
  });
});
