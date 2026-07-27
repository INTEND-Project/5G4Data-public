import { describe, expect, it } from "vitest";

import { sortScripts } from "@/lib/scripts/sort-scripts";

describe("sortScripts", () => {
  const scripts = [
    { id: "1", name: "beta.dsl", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "2", name: "alpha.dsl", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "3", name: "gamma.dsl", createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  it("sorts alphabetically by name by default", () => {
    expect(sortScripts(scripts, "name").map((script) => script.name)).toEqual([
      "alpha.dsl",
      "beta.dsl",
      "gamma.dsl",
    ]);
  });

  it("sorts by createdAt descending with name as tiebreaker", () => {
    expect(sortScripts(scripts, "created").map((script) => script.id)).toEqual([
      "2",
      "1",
      "3",
    ]);
  });
});
