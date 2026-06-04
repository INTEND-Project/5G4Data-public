import { describe, expect, it } from "vitest";

import { prettyPrintIntentTurtle } from "../../src/lib/kg/pretty-print-intent-turtle";

const COMPACT_TURTLE =
  '@prefix data5g: <http://5g4data.eu/5g4data#> . @prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> . @prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> . data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Intent ; imo:handler "inServ" .';

const MULTILINE_TURTLE = `
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Intent ;
    imo:handler "inServ" .
`.trim();

describe("prettyPrintIntentTurtle", () => {
  it("formats compact Turtle with newlines and standard prefixes", () => {
    const formatted = prettyPrintIntentTurtle(COMPACT_TURTLE);

    expect(formatted).not.toBe(COMPACT_TURTLE);
    expect(formatted.split("\n").length).toBeGreaterThan(3);
    expect(formatted).toContain("@prefix");
    expect(formatted).toContain("icm:Intent");
    expect(formatted).toContain('imo:handler "inServ"');
    expect(formatted).toContain("data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("re-serializes already readable Turtle without losing triples", () => {
    const formatted = prettyPrintIntentTurtle(MULTILINE_TURTLE);

    expect(formatted).toContain("@prefix");
    expect(formatted).toContain("icm:Intent");
    expect(formatted).toContain('imo:handler "inServ"');
  });

  it("returns input unchanged when Turtle cannot be parsed", () => {
    const invalid = "@prefix data5g: <http://5g4data.eu/5g4data#> . data5g:Ix a icm:Intent [ unclosed .";
    expect(prettyPrintIntentTurtle(invalid)).toBe(invalid);
  });

  it("returns empty string for empty input", () => {
    expect(prettyPrintIntentTurtle("")).toBe("");
    expect(prettyPrintIntentTurtle("   ")).toBe("");
  });
});
