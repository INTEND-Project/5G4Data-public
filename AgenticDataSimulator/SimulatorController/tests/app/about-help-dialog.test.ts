import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("about help dialog", () => {
  it("explains the controller and main workflow", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/workspace/about-help-dialog.tsx"),
      "utf8",
    );
    expect(source).toContain('role="dialog"');
    expect(source).toContain("intend-icon.png");
    expect(source).toContain("INTEND Data Generation Controller Studio");
    expect(source).toContain(
      "TM Forum intent data generation script design and execution for cognitive continuum",
    );
    expect(source).toContain("workspace-about-help-header");
    expect(source).toContain("INTEND project");
    expect(source).toContain("Knowledge graph");
    expect(source).toContain("Run Script");
    expect(source).toContain("Grafana");
    expect(source).toContain("inSustain");
    expect(source).toContain("Escape");
  });
});
