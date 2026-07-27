import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("show metrics dialog", () => {
  it("surfaces network QoS expected and network metrics section", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/workspace/show-metrics-dialog.tsx"),
      "utf8",
    );
    expect(source).toContain("Network QoS expected");
    expect(source).toContain("preview.intentFlags?.networkQos");
    expect(source).toContain("Network QoS metrics");
    expect(source).toContain("preview.networkObjectives");
  });
});
