import { describe, expect, it } from "vitest";

import { intentsEqual } from "../../src/lib/intents/intent-list-equality";

describe("intentsEqual", () => {
  const sample = [
    {
      intentId: "I04fb0697e3a243e7a292c6cb57e9f797",
      storage: "prometheus" as const,
      grafanaUrl: "http://grafana.example/d/abc?from=now-3h&to=now",
    },
  ];

  it("returns true for identical lists", () => {
    expect(intentsEqual(sample, [...sample])).toBe(true);
  });

  it("returns false when length differs", () => {
    expect(intentsEqual(sample, [])).toBe(false);
  });

  it("returns false when grafana url changes", () => {
    expect(
      intentsEqual(sample, [
        {
          ...sample[0]!,
          grafanaUrl: "http://grafana.example/d/abc?from=1&to=2",
        },
      ]),
    ).toBe(false);
  });
});
