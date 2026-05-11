import { describe, expect, it } from "vitest";

describe("editor completion registration", () => {
  it("builds Monaco completion items from derived metric names", async () => {
    const editorModule = await import("../../src/components/editor/register-completions");

    const completions = editorModule.buildMetricCompletionItems([
      "bandwidth",
      "detection-latency",
    ]);

    expect(completions).toEqual([
      {
        detail: "Derived metric name",
        insertText: "bandwidth",
        kind: "value",
        label: "bandwidth",
      },
      {
        detail: "Derived metric name",
        insertText: "detection-latency",
        kind: "value",
        label: "detection-latency",
      },
    ]);
  });
});
