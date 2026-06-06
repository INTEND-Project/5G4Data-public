import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeCoordinationUtility,
  stripDraftUtilityBlocks,
  stripMisalignedUtilityTurtle,
} from "../tools/postprocess/coordinationUtility.js";

const SAMPLE_CE = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1, data5g:NE1, data5g:CE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:CX1 .

data5g:NE1 a data5g:NetworkExpectation ;
    icm:target data5g:network-slice ;
    log:allOf data5g:CX2 .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:llm-service ;
    log:allOf data5g:COtps, data5g:COenergy .

data5g:COtps a log:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-tps-target_COtps ;
        quan:atLeast [ quan:unit "tokens/s" ; rdf:value 400.0 ] ] .

data5g:COenergy a log:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ rdf:value 10000 ] ] .
`;

test("normalizeCoordinationUtility replaces UtilityFunctions draft with ut/fun/mf blocks", () => {
  const wrongUtility =
    SAMPLE_CE.replace(
      "log:allOf data5g:COtps, data5g:COenergy .",
      `log:allOf data5g:COtps, data5g:COenergy ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/utility> data5g:U_coord .`,
    ) +
    `
data5g:U_arg_p99-tps-target a <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/UtilityArgument> ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/definedBy> data5g:p99-tps-target ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/function> <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/logistic> .
data5g:U_coord a <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/UtilityFunction> ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/hasArgument> data5g:U_arg_p99-tps-target, data5g:U_arg_energy-consumption ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/hasProfile> data5g:UP_coord .
data5g:UP_coord a <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/UtilityProfile> .
`;

  const result = normalizeCoordinationUtility({
    text: wrongUtility,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination",
  });

  assert.ok(result.changes > 0);
  assert.doesNotMatch(result.text, /UtilityFunctions\//);
  assert.match(result.text, /ut:utility data5g:U_coord/);
  assert.match(result.text, /a ut:UtilityInformation/);
  assert.match(result.text, /a fun:function/);
  assert.match(result.text, /mf:logistic/);
});

test("stripMisalignedUtilityTurtle removes UtilityFunctions-only blocks", () => {
  const stripped = stripMisalignedUtilityTurtle(`
data5g:U_arg_energy-consumption a <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/UtilityArgument> ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/definedBy> data5g:energy-consumption .
data5g:I1 a icm:Intent .
`);
  assert.doesNotMatch(stripped, /UtilityFunctions\//);
  assert.match(stripped, /data5g:I1 a icm:Intent/);
});

test("stripDraftUtilityBlocks removes truncated fun:aggregates drafts", () => {
  const truncated =
    SAMPLE_CE +
    `
data5g:U_coord a ut:Utility ;
    ut:hasUtilityProfile data5g:UP_coord .

data5g:UP_coord a ut:UtilityProfile ;
    ut:hasFunction data5g:utilityFn_symmetric .

data5g:utilityFn_symmetric a fun:Function ;
    fun:aggregates (
`;
  const stripped = stripDraftUtilityBlocks(truncated);
  assert.doesNotMatch(stripped, /fun:aggregates/);
  assert.doesNotMatch(stripped, /a ut:Utility\b/);
});

test("normalizeCoordinationUtility repairs truncated utility drafts into parseable turtle", () => {
  const truncated =
    SAMPLE_CE +
    `
data5g:U_coord a ut:Utility ;
    ut:hasUtilityProfile data5g:UP_coord .

data5g:UP_coord a ut:UtilityProfile ;
    ut:hasFunction data5g:utilityFn_symmetric .

data5g:utilityFn_symmetric a fun:Function ;
    fun:aggregates (
`;
  const result = normalizeCoordinationUtility({
    text: truncated,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });
  assert.match(result.text, /a ut:UtilityInformation/);
  assert.match(result.text, /a fun:function/);
  assert.match(result.text, /rdf:value \[ quan:sum/);
  assert.doesNotMatch(result.text, /fun:aggregates/);
});

test("normalizeCoordinationUtility coordinates deployment only when sustainability expectation is absent", () => {
  const result = normalizeCoordinationUtility({
    text: SAMPLE_CE,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });
  assert.ok(result.changes > 0);
  assert.match(result.text, /data5g:U_coord/);
  assert.match(result.text, /data5g:U_arg_p99-tps-target/);
  assert.match(result.text, /data5g:U_arg_energy-consumption/);
  assert.match(result.text, /ut:forMetric\s+\(\s*data5g:U_arg_p99-tps-target\s+data5g:p99-tps-target_COtps/);
  assert.match(result.text, /data5g:coordinates data5g:DE1/);
  assert.doesNotMatch(result.text, /data5g:coordinates[\s\S]*data5g:NE1/);
  assert.match(result.text, /utilityFn_symmetric/);
});

test("normalizeCoordinationUtility coordinates deployment and sustainability for throughput plus energy", () => {
  const withSustainability =
    SAMPLE_CE.replace(
      "data5g:COenergy a log:Condition ;",
      `data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COenergy .

data5g:COenergy a log:Condition ;`,
    );
  const result = normalizeCoordinationUtility({
    text: withSustainability,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });
  assert.match(result.text, /data5g:coordinates data5g:DE1,\s*\n\s*data5g:SE1/);
  assert.doesNotMatch(result.text, /data5g:coordinates[\s\S]*data5g:NE1/);
});

test("normalizeCoordinationUtility includes network expectation when coordinating latency", () => {
  const withLatency =
    SAMPLE_CE.replace(
      "log:allOf data5g:COtps, data5g:COenergy .",
      "log:allOf data5g:COlatency, data5g:COenergy .",
    ).replace(
      "data5g:COtps a log:Condition ;",
      `data5g:NE1 a data5g:NetworkExpectation ;
    icm:target data5g:network-slice ;
    log:allOf data5g:COlatency .

data5g:COlatency a log:Condition ;`,
    ).replace(
      /p99-tps-target_COtps[\s\S]*?400\.0 \] \] \./,
      `latency_COlatency ;
        quan:smaller [ quan:unit "ms" ; rdf:value 50.0 ] ] .`,
    );
  const result = normalizeCoordinationUtility({
    text: withLatency,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on latency and energy consumption",
  });
  assert.match(result.text, /data5g:coordinates data5g:NE1/);
});

test("package includes coordination classification and workflow hooks", () => {
  const classification = readFileSync(
    resolve(process.cwd(), "rules/classification.json"),
    "utf8",
  );
  const workflow = readFileSync(resolve(process.cwd(), "workflow.dsl.json"), "utf8");
  assert.match(classification, /"coordination"/);
  assert.match(classification, /"coordinationSymmetric"/);
  assert.match(workflow, /"id": "coordination"/);
});

test("user coordination guide exists", () => {
  const doc = readFileSync(
    resolve(process.cwd(), "docs/how-coordination-works.md"),
    "utf8",
  );
  assert.match(doc, /create intent using intentGen/);
  assert.match(doc, /symmetric coordination/);
});
