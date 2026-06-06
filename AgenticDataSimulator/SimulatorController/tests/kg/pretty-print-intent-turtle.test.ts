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

  it("inlines single-use blank nodes as square brackets instead of _: labels", () => {
    const expanded = `
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .
_:b0 icm:valuesOfTargetProperty data5g:lat .
_:b1 quan:unit "ms" ; rdf:value 20.0 .
_:b0 quan:smaller _:b1 .
data5g:CO1 a icm:Condition ; set:forAll _:b0 .
`.trim();

    const formatted = prettyPrintIntentTurtle(expanded);

    expect(formatted).toContain("set:forAll [");
    expect(formatted).toContain("quan:smaller [");
    expect(formatted).not.toMatch(/_:b[01]\b/);
  });

  it("serializes RDF lists as parenthesized notation and uses rdfs/time prefixes", () => {
    const expanded = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
data5g:Event1 a <http://www.w3.org/2000/01/rdf-schema#Class> .
_:l0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#first> data5g:lastReportInstant ;
    <http://www.w3.org/1999/02/22-rdf-syntax-ns#rest> _:l1 .
_:l1 <http://www.w3.org/1999/02/22-rdf-syntax-ns#first> data5g:duration1 ;
    <http://www.w3.org/1999/02/22-rdf-syntax-ns#rest> <http://www.w3.org/1999/02/22-rdf-syntax-ns#nil> .
data5g:Event1 <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/delay> _:l0 .
data5g:duration1 a <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/DurationDescription> ;
    <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/numericDuration> 60.0 .
`.trim();

    const formatted = prettyPrintIntentTurtle(expanded);

    expect(formatted).toContain("@prefix rdfs:");
    expect(formatted).toContain("@prefix time:");
    expect(formatted).not.toContain("@prefix ns1:");
    expect(formatted).toContain("a rdfs:Class");
    expect(formatted).toMatch(/time:delay \( data5g:lastReportInstant data5g:duration1 \)/);
    expect(formatted).toContain("time:numericDuration 60.0");
    expect(formatted).not.toContain("rdf:first");
    expect(formatted).not.toContain("rdf:rest");
    expect(formatted).toContain("time:DurationDescription");
    expect(formatted).not.toContain("@prefix rdf4j:");
    expect(formatted).not.toContain("@prefix sesame:");
    expect(formatted).not.toContain("@prefix owl:");
  });

  it("uses mf, time, ut, and uf prefixes for coordination utility triples", () => {
    const expanded = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
data5g:CE1 a data5g:CoordinationExpectation ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/utility> data5g:U_coord .
data5g:U_arg_energy-consumption a <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/UtilityArgument> ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/definedBy> data5g:energy-consumption ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/function> <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/logistic> .
data5g:duration1 a <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/DurationDescription> ;
    <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/numericDuration> 5.0 .
`.trim();

    const formatted = prettyPrintIntentTurtle(expanded);

    expect(formatted).toContain("@prefix mf:");
    expect(formatted).toContain("@prefix time:");
    expect(formatted).toContain("@prefix uf:");
    expect(formatted).toContain("uf:utility data5g:U_coord");
    expect(formatted).toContain("uf:UtilityArgument");
    expect(formatted).toContain("uf:definedBy");
    expect(formatted).toContain("mf:logistic");
    expect(formatted).toContain("time:DurationDescription");
    const body = formatted
      .split("\n")
      .filter((line) => !line.trim().startsWith("@prefix"))
      .join("\n");
    expect(body).not.toContain("<http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/");
    expect(body).not.toContain("<http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/");
  });

  it("orders subjects with Intent first, then each Expectation and its Conditions and Context", () => {
    const expanded = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
data5g:COdeployment a icm:Condition .
data5g:CXshared a icm:Context .
data5g:COsustain1 a icm:Condition .
data5g:COsustain2 a icm:Condition .
data5g:DE1 a data5g:DeploymentExpectation ; log:allOf data5g:CXshared, data5g:COdeployment .
data5g:SE1 a data5g:SustainabilityExpectation ; log:allOf data5g:COsustain2, data5g:COsustain1, data5g:CXshared .
data5g:RE1 a icm:ObservationReportingExpectation .
data5g:I1 a icm:Intent ; log:allOf data5g:SE1, data5g:DE1, data5g:RE1 .
`.trim();

    const formatted = prettyPrintIntentTurtle(expanded);
    const order = [...formatted.matchAll(/^data5g:(\S+)/gm)].map((match) => `data5g:${match[1]}`);

    expect(order.indexOf("data5g:I1")).toBe(0);
    expect(order.indexOf("data5g:SE1")).toBeLessThan(order.indexOf("data5g:COsustain2"));
    expect(order.indexOf("data5g:COsustain2")).toBeLessThan(order.indexOf("data5g:COsustain1"));
    expect(order.indexOf("data5g:COsustain1")).toBeLessThan(order.indexOf("data5g:CXshared"));
    expect(order.indexOf("data5g:DE1")).toBeLessThan(order.indexOf("data5g:COdeployment"));
    expect(order.indexOf("data5g:COdeployment")).toBeLessThan(order.indexOf("data5g:RE1"));
  });

  it("formats rdfs containers with square brackets", () => {
    const expanded = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
data5g:RE1 a icm:ObservationReportingExpectation ;
    icm:reportDestinations _:c0 .
_:c0 a rdfs:Container ;
    rdfs:member data5g:prometheus .
`.trim();

    const formatted = prettyPrintIntentTurtle(expanded);

    expect(formatted).toContain("icm:reportDestinations [");
    expect(formatted).toContain("a rdfs:Container");
    expect(formatted).toContain("rdfs:member data5g:prometheus");
    expect(formatted).not.toMatch(/_:c0\b/);
  });
});
