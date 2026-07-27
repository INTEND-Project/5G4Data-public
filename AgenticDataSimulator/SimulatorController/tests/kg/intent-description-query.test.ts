import { describe, expect, it } from "vitest";

import {
  buildIntentDescriptionQuery,
  descriptionFromSparqlBindings,
} from "../../src/lib/kg/intent-description-query";

describe("intent description query", () => {
  it("buildIntentDescriptionQuery embeds graph, intent literal, and dct:description", () => {
    const graph = "urn:intend:kg:telenor-5g4data:demo";
    const intent = "I04fb0697e3a243e7a292c6cb57e9f797";
    const q = buildIntentDescriptionQuery(graph, intent);

    expect(q).toContain(`GRAPH <${graph}>`);
    expect(q).toContain("dct:description");
    expect(q).toContain("icm:Intent");
    expect(q).toContain('FILTER(REPLACE(STR(?intent), ".*[#/]", "") = "I04fb0697e3a243e7a292c6cb57e9f797")');
  });

  it("descriptionFromSparqlBindings returns the first description value", () => {
    expect(
      descriptionFromSparqlBindings([
        { description: { value: "Deploy LLM near Tromsø with sustainable operation." } },
      ]),
    ).toBe("Deploy LLM near Tromsø with sustainable operation.");
  });

  it("descriptionFromSparqlBindings returns null when no description is present", () => {
    expect(descriptionFromSparqlBindings([])).toBeNull();
  });
});
