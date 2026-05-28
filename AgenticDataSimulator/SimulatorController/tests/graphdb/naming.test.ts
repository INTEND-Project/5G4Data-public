import { describe, expect, it } from "vitest";

async function loadNamingModule() {
  try {
    return await import("../../src/lib/graphdb/naming");
  } catch (error) {
    return { error };
  }
}

describe("GraphDB naming", () => {
  it("derives a stable repository id and named graph iri", async () => {
    const loaded = await loadNamingModule();

    expect("error" in loaded ? loaded.error : undefined).toBeUndefined();

    if ("error" in loaded) {
      return;
    }

    expect(
      loaded.buildRepositoryId("telenor.5g4data", "KG Avalanche Demo", "alice"),
    ).toBe("telenor-5g4data-alice-kg-avalanche-demo");
    expect(
      loaded.buildGraphIri("telenor.5g4data", "KG Avalanche Demo", "alice"),
    ).toBe("urn:intend:kg:telenor-5g4data:alice:kg-avalanche-demo");
  });
});
