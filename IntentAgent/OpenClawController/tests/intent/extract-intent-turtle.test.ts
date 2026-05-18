import { describe, expect, it } from "vitest";

import {
  extractIntentTurtle,
  extractIntentLocalIdFromTurtle,
  extractIntentUuidSuffixFromTurtle,
  normalizedIntentIdFromStoreResponse,
} from "../../src/lib/intent/extract-intent-turtle";

describe("extractIntentTurtle", () => {
  it("reads Turtle from a fenced turtle block embedded in prose", () => {
    const visible =
      'Here you go:\n```turtle\n@prefix data5g: <http://5g4data.eu/5g4data#> .\n@prefix icm: <http://example/icm/> .\ndata5g:Ie4d6d6c6bc414a5e9bd5c4b97b7c4e91 a icm:Intent .\n```\nthanks!';
    expect(extractIntentTurtle(visible)).toContain("data5g:Ie4d6d6c6bc414a5e9bd5c4b97b7c4e91");
    expect(extractIntentTurtle(visible)).toContain("@prefix");
  });

  it("accepts turtle-only payloads when prefixed and intent-shaped", () => {
    const s =
      "@prefix icm: <http://ex/icm/> .\n_:x a icm:Intent .\n";
    expect(extractIntentTurtle(s)).toBeTruthy();
  });

  it("returns null when prose has no RDF intent cues", () => {
    expect(extractIntentTurtle("still thinking…")).toBeNull();
  });
});

describe("extractIntentLocalIdFromTurtle", () => {
  it("returns I + 32 hex for data5g intent CURIE", () => {
    expect(
      extractIntentLocalIdFromTurtle(
        "@prefix data5g: <http://5g4data.eu/5g4data#> .\ndata5g:Ie4d6d6c6bc414a5e9bd5c4b97b7c4e91 a owl:Thing .",
      ),
    ).toBe("Ie4d6d6c6bc414a5e9bd5c4b97b7c4e91");
  });
});

describe("normalizedIntentIdFromStoreResponse", () => {
  it("adds missing I prefix to bare uuid", () => {
    expect(normalizedIntentIdFromStoreResponse("ebf6b23563a14494a136188776cb5f54")).toBe(
      "Iebf6b23563a14494a136188776cb5f54",
    );
  });

  it("passes through I-prefixed id", () => {
    expect(normalizedIntentIdFromStoreResponse("Iebf6b23563a14494a136188776cb5f54")).toBe(
      "Iebf6b23563a14494a136188776cb5f54",
    );
  });
});

describe("extractIntentUuidSuffixFromTurtle", () => {
  it("matches data5g:I + 32 hex like the Python simulator", () => {
    expect(
      extractIntentUuidSuffixFromTurtle("@prefix data5g: <http://5g4data.eu/5g4data#> .\ndata5g:Ie4d6d6c6bc414a5e9bd5c4b97b7c4e91 a owl:Thing ."),
    ).toBe("e4d6d6c6bc414a5e9bd5c4b97b7c4e91");
  });
});
