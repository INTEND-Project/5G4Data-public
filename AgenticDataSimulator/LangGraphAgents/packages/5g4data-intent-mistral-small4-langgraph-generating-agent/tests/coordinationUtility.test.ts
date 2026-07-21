import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "n3";
import {
  applyPostprocessor,
  ensureCoordinationUtilityLiteralTypes,
  hasIncompleteCoordinationUtility,
  isCompleteMfLogisticCall,
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
    log:allOf data5g:DE1, data5g:SE1, data5g:NE1, data5g:CE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COtps, data5g:CX1 .

data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COenergy .

data5g:NE1 a data5g:NetworkExpectation ;
    icm:target data5g:network-slice ;
    log:allOf data5g:CX2 .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
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
  assert.match(result.text, /ut:utility data5g:U_coord(?:_[0-9a-f]+)?/);
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
  const withoutSe = SAMPLE_CE.replace(
    /data5g:SE1 a data5g:SustainabilityExpectation ;[\s\S]*?log:allOf data5g:COenergy \.\n\n/,
    "",
  )
    .replace("log:allOf data5g:DE1, data5g:SE1, data5g:NE1, data5g:CE1", "log:allOf data5g:DE1, data5g:NE1, data5g:CE1")
    .replace("log:allOf data5g:COtps, data5g:COenergy", "log:allOf data5g:COtps");
  const result = normalizeCoordinationUtility({
    text: withoutSe,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput",
  });
  assert.ok(result.changes > 0);
  assert.match(result.text, /data5g:U_coord/);
  assert.match(result.text, /data5g:U_arg_p99-tps-target/);
  assert.match(result.text, /ut:forMetric\s+\(\s*data5g:U_arg_p99-tps-target\s+data5g:p99-tps-target_COtps/);
  assert.match(result.text, /data5g:coordinates data5g:DE1/);
  assert.doesNotMatch(result.text, /data5g:coordinates[\s\S]*data5g:NE1/);
  assert.match(result.text, /utilityFn_symmetric(?:_[0-9a-f]+)?/);
});

test("normalizeCoordinationUtility coordinates deployment and sustainability for throughput plus energy", () => {
  const result = normalizeCoordinationUtility({
    text: SAMPLE_CE,
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
    )
      .replace("log:allOf data5g:COtps, data5g:CX1 .", "log:allOf data5g:CX1 .")
      .replace(
        "data5g:COtps a log:Condition ;",
        `data5g:COlatency a log:Condition ;`,
      )
      .replace(
        /p99-tps-target_COtps[\s\S]*?400\.0 \] \] \./,
        `latency_COlatency ;
        quan:smaller [ quan:unit "ms" ; rdf:value 50.0 ] ] .`,
      )
      .replace(
        "log:allOf data5g:CX2 .",
        "log:allOf data5g:COlatency, data5g:CX2 .",
      );
  const result = normalizeCoordinationUtility({
    text: withLatency,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on latency and energy consumption",
  });
  assert.match(result.text, /data5g:coordinates data5g:NE1/);
});

test("package includes coordination classification and workflow hooks", () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const classification = readFileSync(resolve(packageRoot, "rules/classification.json"), "utf8");
  const workflow = readFileSync(resolve(packageRoot, "workflow.dsl.json"), "utf8");
  assert.match(classification, /"coordination"/);
  assert.match(classification, /"coordinationSymmetric"/);
  assert.match(workflow, /"id": "coordination"/);
});

test("normalizeCoordinationUtility derives utility from metric-only CE conditions", () => {
  const metricReferenceCe = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .

data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1, data5g:SE1, data5g:CE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COdeploy .

data5g:COdeploy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .

data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COsustain .

data5g:COsustain a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COsustain ;
        quan:larger [ quan:unit "J" ; rdf:value 50 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COcoordTps, data5g:COcoordEnergy ;
    ut:utility data5g:U_coord ;
    data5g:coordinates data5g:DE1, data5g:SE1 .

data5g:COcoordTps a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COcoordTps ] .

data5g:COcoordEnergy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COcoordEnergy ] .
`;

  const result = normalizeCoordinationUtility({
    text: metricReferenceCe,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination between token throughput and energy consumption",
  });

  assert.match(result.text, /a ut:UtilityInformation/);
  assert.match(result.text, /a fun:function/);
  assert.match(result.text, /data5g:U_arg_p99-token-target/);
  assert.match(result.text, /data5g:U_arg_energy-consumption/);
  assert.match(result.text, /log:allOf data5g:COdeploy, data5g:COsustain/);
  assert.doesNotMatch(result.text, /\bdata5g:COcoordTps\b/);
  assert.doesNotMatch(result.text, /\bdata5g:COcoordEnergy\b/);
  assert.match(
    result.text,
    /ut:forMetric\s+\(\s*data5g:U_arg_p99-token-target\s+data5g:p99-token-target_COdeploy/,
  );
  assert.match(
    result.text,
    /ut:forMetric\s+\(\s*data5g:U_arg_energy-consumption\s+data5g:energy-consumption_COsustain/,
  );
});

test("normalizeCoordinationUtility aligns energy-consumption CE metric with power-consumption SE condition", () => {
  const metricReferenceCe = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .

data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1, data5g:SE1, data5g:CE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    log:allOf data5g:COdeploy .

data5g:COdeploy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .

data5g:SE1 a data5g:SustainabilityExpectation ;
    log:allOf data5g:COsustain .

data5g:COsustain a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:power-consumption_COsustain ;
        quan:smaller [ quan:unit "W" ; rdf:value 3000 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COcoordTps, data5g:COcoordEnergy ;
    ut:utility data5g:U_coord .

data5g:COcoordTps a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COcoordTps ] .

data5g:COcoordEnergy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COcoordEnergy ] .
`;

  const result = normalizeCoordinationUtility({
    text: metricReferenceCe,
    flags: { coordinationSymmetric: true },
    userText:
      "Deploy a small llm with symmetric coordination on token throughput and energy consumption",
  });

  assert.match(result.text, /log:allOf data5g:COdeploy, data5g:COsustain/);
  assert.match(result.text, /fun:argumentNames \( data5g:U_arg_p99-token-target data5g:U_arg_power-consumption \)/);
  assert.match(result.text, /fun:arityMin 2 ; fun:arityMax 2/);
  assert.match(result.text, /mf:logistic \( data5g:U_arg_p99-token-target/);
  assert.match(result.text, /mf:logistic \( data5g:U_arg_power-consumption/);
});

test("normalizeCoordinationUtility prefers energy-consumption over deprecated container-cpu-watts", () => {
  const legacyAndCurrent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1, data5g:SE1, data5g:CE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    log:allOf data5g:COdeploy .

data5g:COdeploy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .

data5g:SE1 a data5g:SustainabilityExpectation ;
    log:allOf data5g:COlegacy, data5g:COenergy .

data5g:COlegacy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:container-cpu-watts_COlegacy ;
        quan:smaller [ quan:unit "W" ; rdf:value 5000 ]
    ] .

data5g:COenergy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:larger [ quan:unit "J" ; rdf:value 50 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COcoordTps .

data5g:COcoordTps a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COcoordTps ] .
`;

  const result = normalizeCoordinationUtility({
    text: legacyAndCurrent,
    flags: { coordinationSymmetric: true },
    userText:
      "Deploy a small llm with symmetric coordination on token throughput and energy consumption",
  });

  assert.match(result.text, /fun:argumentNames \( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption \)/);
  assert.doesNotMatch(result.text, /U_arg_container-cpu-watts/);
});

test("normalizeCoordinationUtility infers missing energy metric when CE only coordinates throughput", () => {
  const singleCeCondition = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1, data5g:SE1, data5g:CE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    log:allOf data5g:COdeploy .

data5g:COdeploy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .

data5g:SE1 a data5g:SustainabilityExpectation ;
    log:allOf data5g:COsustain .

data5g:COsustain a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COsustain ;
        quan:larger [ quan:unit "J" ; rdf:value 50 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COcoordTps .

data5g:COcoordTps a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COcoordTps ] .
`;

  const result = normalizeCoordinationUtility({
    text: singleCeCondition,
    flags: { coordinationSymmetric: true },
    userText:
      "Deploy a small llm with symmetric coordination on token throughput and energy consumption",
  });

  assert.match(result.text, /fun:argumentNames \( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption \)/);
  assert.match(result.text, /fun:arityMin 2 ; fun:arityMax 2/);
  assert.match(result.text, /data5g:coordinates data5g:DE1,\s*\n\s*data5g:SE1/);
});

test("isCompleteMfLogisticCall requires four typed mf:logistic arguments", () => {
  assert.equal(
    isCompleteMfLogisticCall(
      `data5g:U_arg_p99-tps-target "0.03"^^xsd:decimal "0.5"^^xsd:decimal "340tokens/s"^^quan:quantity`,
    ),
    true,
  );
  assert.equal(
    isCompleteMfLogisticCall(
      `data5g:U_arg_energy-consumption "-0.001"^^xsd:decimal "0.5"^^xsd:decimal "11500J"^^quan:quantity`,
    ),
    true,
  );
  assert.equal(
    isCompleteMfLogisticCall(
      `data5g:U_arg_p99-token-target "340token/s"^^quan:quantity`,
    ),
    false,
  );
});

test("stripDraftUtilityBlocks removes incomplete mf:logistic utilityFn drafts", () => {
  const malformed =
    SAMPLE_CE +
    `
data5g:utilityFn_symmetric a fun:function ;
    fun:argumentNames ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) ;
    rdf:value [ quan:sum (
        [ data5g:standardK 12.0 ;
          data5g:x0Fraction 0.85 ;
          mf:logistic ( data5g:U_arg_p99-tps-target "340tokens/s"^^quan:quantity ) ]
    ) ] .
`;
  const stripped = stripDraftUtilityBlocks(malformed);
  assert.doesNotMatch(stripped, /utilityFn_symmetric(?:_[0-9a-f]+)?/);
});

test("normalizeCoordinationUtility replaces malformed mf:logistic drafts with four arguments", () => {
  const ceWithEnergyUnit = SAMPLE_CE.replace(
    'quan:smaller [ rdf:value 10000 ]',
    'quan:smaller [ quan:unit "J" ; rdf:value 10000 ]',
  );
  const malformed =
    ceWithEnergyUnit +
    `
data5g:U_coord a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-tps-target data5g:p99-tps-target_COtps ), ( data5g:U_arg_energy-consumption data5g:energy-consumption_COenergy ) ;
    ut:function data5g:utilityFn_symmetric ;
    ut:utilityProfile data5g:UP_coord ;
    ut:withArguments ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) .

data5g:UP_coord a ut:UtilityProfile ;
    ut:maxUtility 1.0 ;
    ut:minUtility 0.0 ;
    ut:utilityFunction data5g:utilityFn_symmetric .

data5g:utilityFn_symmetric a fun:function ;
    fun:argumentNames ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) ;
    fun:argumentTypes ( quan:Quantity ) ;
    fun:arityMax 2 ;
    fun:arityMin 2 ;
    fun:resultType quan:Quantity ;
    rdf:value [
  quan:sum ( [
      data5g:standardK 12.0 ;
      data5g:x0Fraction 0.85 ;
      mf:logistic ( data5g:U_arg_p99-tps-target "340tokens/s"^^quan:quantity )
      ] [
      data5g:standardK 12.0 ;
      data5g:x0Fraction 0.85 ;
      mf:logistic ( data5g:U_arg_energy-consumption "11500J"^^quan:quantity )
      ] )
    ] .
`;

  const result = normalizeCoordinationUtility({
    text: malformed,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });

  assert.match(result.text, /mf:logistic \( data5g:U_arg_p99-tps-target[\s\S]*?"0\.03"\^\^xsd:decimal[\s\S]*?"0\.5"\^\^xsd:decimal[\s\S]*?"340tokens\/s"\^\^quan:quantity \)/);
  assert.match(result.text, /mf:logistic \( data5g:U_arg_energy-consumption[\s\S]*?"-0\.0012"\^\^xsd:decimal[\s\S]*?"0\.5"\^\^xsd:decimal[\s\S]*?"11500J"\^\^quan:quantity \)/);
  assert.match(result.text, /data5g:standardK "12"\^\^xsd:decimal/);
  assert.match(result.text, /data5g:x0Fraction "0\.85"\^\^xsd:decimal/);
  assert.equal((result.text.match(/\bdata5g:U_coord(?:_[0-9a-f]+)?\s+a\b/g) ?? []).length, 1);
  assert.equal((result.text.match(/\bdata5g:UP_coord(?:_[0-9a-f]+)?\s+a\b/g) ?? []).length, 1);
  assert.equal((result.text.match(/\bdata5g:utilityFn_symmetric(?:_[0-9a-f]+)?\s+a\b/g) ?? []).length, 1);
});

test("stripDraftUtilityBlocks removes U_coord when linked utilityFn is incomplete", () => {
  const combined =
    SAMPLE_CE +
    `
data5g:U_coord a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-tps-target data5g:p99-tps-target_COtps ), ( data5g:U_arg_energy-consumption data5g:energy-consumption_COenergy ) ;
    ut:function data5g:utilityFn_symmetric ;
    ut:utilityProfile data5g:UP_coord ;
    ut:withArguments ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) .

data5g:UP_coord a ut:UtilityProfile ;
    ut:maxUtility 1.0 ;
    ut:minUtility 0.0 .

data5g:utilityFn_symmetric a fun:function ;
    fun:argumentNames ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) ;
    rdf:value [ quan:sum ( [
        data5g:standardK 12.0 ;
        data5g:x0Fraction 0.85 ;
        mf:logistic ( data5g:U_arg_p99-tps-target "340tokens/s"^^quan:quantity )
      ] ) ] .
`;
  const stripped = stripDraftUtilityBlocks(combined);
  assert.doesNotMatch(stripped, /\bdata5g:U_coord(?:_[0-9a-f]+)?\s+a\b/);
  assert.doesNotMatch(stripped, /\bdata5g:utilityFn_symmetric(?:_[0-9a-f]+)?\s+a\b/);
});

test("ensureCoordinationUtilityLiteralTypes adds xsd:decimal to bare mf:logistic args", () => {
  const bare = `data5g:utilityFn_symmetric a fun:function ;
    rdf:value [ quan:sum ( [
      data5g:standardK 12.0;
      data5g:x0Fraction 0.85;
      mf:logistic ( data5g:U_arg_p99-token-target 0.03 0.5 "340token/s"^^quan:quantity )
      ] ) ] .
data5g:UP_coord a ut:UtilityProfile ;
    ut:maxUtility 1.0 ;
    ut:minUtility 0.0 .`;

  const typed = ensureCoordinationUtilityLiteralTypes(bare);
  assert.match(typed, /mf:logistic \( data5g:U_arg_p99-token-target "0\.03"\^\^xsd:decimal "0\.5"\^\^xsd:decimal/);
  assert.match(typed, /data5g:standardK "12(?:\.0)?"\^\^xsd:decimal/);
  assert.match(typed, /ut:maxUtility "1(?:\.0)?"\^\^xsd:decimal/);
  assert.match(typed, /ut:minUtility "0(?:\.0)?"\^\^xsd:decimal \./);
});

test("ensureCoordinationUtilityLiteralTypes types bare UP_coord bounds without mf:logistic", () => {
  const bare = `data5g:UP_coord a ut:UtilityProfile ;
    ut:maxUtility "1.0"^^xsd:decimal ;
    ut:minUtility 0.0 .`;

  const typed = ensureCoordinationUtilityLiteralTypes(bare);
  assert.match(typed, /ut:minUtility "0\.0"\^\^xsd:decimal \./);
  assert.match(typed, /ut:maxUtility "1\.0"\^\^xsd:decimal ;/);
});

test("hasIncompleteCoordinationUtility detects bare numeric mf:logistic args", () => {
  const bare = `mf:logistic ( data5g:U_arg_p99-token-target 0.03 0.5 "340token/s"^^quan:quantity )`;
  assert.equal(hasIncompleteCoordinationUtility(bare), true);
});

test("hasIncompleteCoordinationUtility detects two-argument mf:logistic drafts", () => {
  const malformed = `data5g:utilityFn_symmetric a fun:function ;
    rdf:value [ quan:sum ( [
        mf:logistic ( data5g:U_arg_p99-token-target "340token/s"^^quan:quantity )
      ] ) ] .`;
  assert.equal(hasIncompleteCoordinationUtility(malformed), true);
});

test("applyPostprocessor normalizes utility when incomplete mf:logistic is present without coordination flag", () => {
  const ceWithEnergyUnit = SAMPLE_CE.replace(
    'quan:smaller [ rdf:value 10000 ]',
    'quan:smaller [ quan:unit "J" ; rdf:value 10000 ]',
  ).replace("p99-tps-target", "p99-token-target");
  const malformed =
    ceWithEnergyUnit +
    `
data5g:U_coord a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-token-target data5g:p99-token-target_COtps ), ( data5g:U_arg_energy-consumption data5g:energy-consumption_COenergy ) ;
    ut:function data5g:utilityFn_symmetric ;
    ut:utilityProfile data5g:UP_coord ;
    ut:withArguments ( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption ) .
data5g:UP_coord a ut:UtilityProfile ;
    ut:maxUtility 1.0 ;
    ut:minUtility 0.0 .
data5g:utilityFn_symmetric a fun:function ;
    fun:argumentNames ( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption ) ;
    fun:argumentTypes ( quan:Quantity ) ;
    fun:arityMax 2 ;
    fun:arityMin 2 ;
    fun:resultType quan:Quantity ;
    rdf:value [
  quan:sum ( [
      data5g:standardK 12.0;
      data5g:x0Fraction 0.85;
      mf:logistic ( data5g:U_arg_p99-token-target "340token/s"^^quan:quantity )
      ] [
      data5g:standardK 12.0;
      data5g:x0Fraction 0.85;
      mf:logistic ( data5g:U_arg_energy-consumption "58J"^^quan:quantity )
      ] )
  ].`;

  const result = applyPostprocessor({
    text: malformed,
    context: {
      intentFlags: { coordination: false, coordinationSymmetric: false },
      userPrompt:
        "Deploy a small llm in a datacenter near Tromsø/Norway with symmetric coordination on token throughput and energy consumption",
    },
  });

  assert.match(result.text, /"0\.03"\^\^xsd:decimal/);
  assert.match(result.text, /"-0\.0012"\^\^xsd:decimal/);
  assert.match(result.text, /"340tokens\/s"\^\^quan:quantity/);
  assert.match(result.text, /"11500J"\^\^quan:quantity/);
  assert.doesNotMatch(
    result.text,
    /mf:logistic \( data5g:U_arg_p99-token-target "340token\/s"\^\^quan:quantity \)/,
  );
});

test("applyPostprocessor adds utility when CE has data5g:coordinates and no utility subjects", () => {
  const intent =
    `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .

data5g:CE2500bb197bf94393817a9ecea9e8b6c5 a data5g:CoordinationExpectation,
    icm:Expectation,
    icm:IntentElement ;
    data5g:coordinates data5g:DE094af95a0b10417caac0b2a6a4808c7d, data5g:SE9d28e699497945bb90c9151106fe3dba ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:CO302b29364e7e486495da76c675b929fb, data5g:COac8cb743caf0412eac57d4b066d0cc9f ;
    ut:utility data5g:U_coord .
data5g:DE094af95a0b10417caac0b2a6a4808c7d a data5g:DeploymentExpectation ;
    log:allOf data5g:CO302b29364e7e486495da76c675b929fb .
data5g:SE9d28e699497945bb90c9151106fe3dba a data5g:SustainabilityExpectation ;
    log:allOf data5g:COac8cb743caf0412eac57d4b066d0cc9f .
data5g:CO302b29364e7e486495da76c675b929fb a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_CO302b29364e7e486495da76c675b929fb;
  quan:larger [ quan:unit "token/s"; rdf:value 400 ]
    ].
data5g:COac8cb743caf0412eac57d4b066d0cc9f a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COac8cb743caf0412eac57d4b066d0cc9f;
  quan:smaller [ quan:unit "J"; rdf:value 50 ]
    ].`;

  const result = applyPostprocessor({
    text: intent,
    context: {
      intentFlags: {},
      userPrompt:
        "Deploy a small llm with symmetric coordination on token throughput and energy consumption",
    },
  });

  assert.notEqual(result.note, "coordinationUtility: no parseable CE conditions; removed malformed utility blocks");
  assert.match(result.text, /\bdata5g:U_coord(?:_[0-9a-f]+)?\s+a\s+ut:UtilityInformation\b/);
  assert.match(result.text, /\bdata5g:utilityFn_symmetric\s+a\s+fun:function\b/);
  assert.match(result.text, /mf:logistic \( data5g:U_arg_p99-token-target[\s\S]*?"0\.03"\^\^xsd:decimal/);
  assert.match(result.text, /mf:logistic \( data5g:U_arg_energy-consumption[\s\S]*?"-0\.24"\^\^xsd:decimal/);
});

test("applyPostprocessor normalizes utility when CoordinationExpectation is present without coordination flag", () => {
  const ceWithEnergyUnit = SAMPLE_CE.replace(
    'quan:smaller [ rdf:value 10000 ]',
    'quan:smaller [ quan:unit "J" ; rdf:value 10000 ]',
  );
  const malformed =
    ceWithEnergyUnit +
    `
data5g:U_coord a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-tps-target data5g:p99-tps-target_COtps ), ( data5g:U_arg_energy-consumption data5g:energy-consumption_COenergy ) ;
    ut:function data5g:utilityFn_symmetric ;
    ut:utilityProfile data5g:UP_coord ;
    ut:withArguments ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) .

data5g:UP_coord a ut:UtilityProfile ;
    ut:maxUtility 1.0 ;
    ut:minUtility 0.0 .

data5g:utilityFn_symmetric a fun:function ;
    fun:argumentNames ( data5g:U_arg_p99-tps-target data5g:U_arg_energy-consumption ) ;
    rdf:value [ quan:sum ( [
        data5g:standardK 12.0 ;
        data5g:x0Fraction 0.85 ;
        mf:logistic ( data5g:U_arg_p99-tps-target "340tokens/s"^^quan:quantity )
      ] [
        data5g:standardK 12.0 ;
        data5g:x0Fraction 0.85 ;
        mf:logistic ( data5g:U_arg_energy-consumption "11500J"^^quan:quantity )
      ] ) ] .
`;

  const result = applyPostprocessor({
    text: malformed,
    context: {
      intentFlags: { coordination: false, coordinationSymmetric: false },
      runtimeContext:
        "User request: Deploy LLM with symmetric coordination on token throughput and energy consumption",
    },
  });

  assert.match(result.text, /"0\.03"\^\^xsd:decimal/);
  assert.match(result.text, /"-0\.0012"\^\^xsd:decimal/);
  assert.doesNotMatch(
    result.text,
    /mf:logistic \( data5g:U_arg_p99-tps-target "340tokens\/s"\^\^quan:quantity \)/,
  );
});

test("normalizeCoordinationUtility replaces inline ut:UtilityFunction on CE and adds log:allOf", () => {
  const intent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .

data5g:DE1 a data5g:DeploymentExpectation ;
    log:allOf data5g:COtps .
data5g:SE1 a data5g:SustainabilityExpectation ;
    log:allOf data5g:COenergy .
data5g:COtps a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COtps;
  quan:larger [ quan:unit "token/s"; rdf:value 400 ]
    ].
data5g:COenergy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COenergy;
  quan:smaller [ quan:unit "J"; rdf:value 50 ]
    ].
data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    data5g:coordinates data5g:DE1, data5g:SE1 ;
    ut:utility [
        a ut:UtilityFunction;
  ut:arguments ( [
      a ut:UtilityArgument;
      ut:name "U_arg_p99-token-target"
      ] )
  ].`;

  const result = normalizeCoordinationUtility({
    text: intent,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination between token throughput and energy consumption",
  });

  assert.match(
    result.text,
    /data5g:CE1 a data5g:CoordinationExpectation[\s\S]*?log:allOf data5g:COtps, data5g:COenergy/,
  );
  assert.match(result.text, /ut:utility data5g:U_coord(?:_[0-9a-f]+)?\s*;/);
  assert.doesNotMatch(result.text, /ut:UtilityFunction/);
  assert.match(result.text, /\bdata5g:utilityFn_symmetric\s+a\s+fun:function\b/);
  assert.match(result.text, /"-0\.24"\^\^xsd:decimal/);
});

test("normalizeCoordinationUtility rewrites coordination ObservationReportingExpectation target to coordination-service", () => {
  const intent =
    SAMPLE_CE +
    `
data5g:RE_coord a icm:ObservationReportingExpectation ;
    dct:description "Coordination reports every 5 minutes" ;
    icm:reportTriggers [
        a rdfs:Container;
        rdfs:member data5g:FiveMinuteReportEventCoordination_COtps
    ];
    icm:target data5g:llm-service .`;

  const result = normalizeCoordinationUtility({
    text: intent,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });

  assert.match(
    result.text,
    /data5g:RE_coord a icm:ObservationReportingExpectation[\s\S]*?icm:target data5g:coordination-service/,
  );
  assert.doesNotMatch(
    result.text,
    /ObservationReportingExpectation[\s\S]*?icm:target data5g:llm-service/,
  );
});

test("normalizeCoordinationUtility rewrites CoordinationExpectation target to coordination-service", () => {
  const legacyTarget = SAMPLE_CE.replace(
    "icm:target data5g:coordination-service ;",
    "icm:target data5g:llm-service ;",
  );
  const result = normalizeCoordinationUtility({
    text: legacyTarget,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });
  assert.match(result.text, /data5g:CE1 a data5g:CoordinationExpectation[\s\S]*?icm:target data5g:coordination-service/);
  assert.doesNotMatch(result.text, /CoordinationExpectation[\s\S]*?icm:target data5g:llm-service/);
});

test("applyPostprocessor reuses expectation conditions instead of flawed CE-only stubs (throughput and energy)", () => {
  const intent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COdeploy .

data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COpower, data5g:COenergy .

data5g:COdeploy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .

data5g:COpower a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:power-consumption_COpower ;
        quan:smaller [ quan:unit "W" ; rdf:value 50 ]
    ] .

data5g:COenergy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ quan:unit "MJ" ; rdf:value 100 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COstubTps, data5g:COstubEnergy ;
    data5g:coordinates data5g:DE1, data5g:SE1 .

data5g:COstubTps a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COstubTps ] .

data5g:COstubEnergy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COstubEnergy ] .
`;

  const result = applyPostprocessor({
    text: intent,
    context: {
      userPrompt:
        "Deploy rusty-llm with symmetric coordination between token throughput and energy consumption",
    },
  });

  assert.match(result.text, /data5g:CE1[\s\S]*?log:allOf data5g:COdeploy, data5g:COenergy/);
  assert.doesNotMatch(result.text, /\bdata5g:COstubTps\b/);
  assert.doesNotMatch(result.text, /\bdata5g:COstubEnergy\b/);
  assert.doesNotMatch(result.text, /data5g:CE1[\s\S]*?log:allOf[\s\S]*data5g:COpower/);
  assert.match(result.text, /data5g:SE1[\s\S]*?log:allOf[\s\S]*data5g:COpower/);
  assert.match(
    result.text,
    /ut:forMetric\s+\(\s*data5g:U_arg_p99-token-target\s+data5g:p99-token-target_COdeploy/,
  );
  assert.match(
    result.text,
    /ut:forMetric\s+\(\s*data5g:U_arg_energy-consumption\s+data5g:energy-consumption_COenergy/,
  );
});

test("applyPostprocessor emits parseable Turtle after replacing CE-only stubs", () => {
  const intent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COdeploy .

data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COenergy .

data5g:COdeploy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .

data5g:COenergy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ quan:unit "MJ" ; rdf:value 100 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf
        data5g:COstubTps,
        data5g:COstubEnergy .
    data5g:coordinates data5g:DE1, data5g:SE1 .

data5g:COstubTps a icm:Condition ;
    dct:description "Coordination condition for p99-token-target." ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COstubTps ] .

data5g:COstubEnergy a icm:Condition ;
    dct:description "Coordination condition for energy-consumption." ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COstubEnergy ] .

data5g:durationCoordination_COstubTps a time:DurationDescription ;
    time:numericDuration "5"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:FiveMinuteReportEventCoordination_COstubTps a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:durationCoordination_COstubTps ) ;
    imo:eventFor data5g:CE1 .

data5g:REcoord a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service ;
    icm:reportTriggers [ a rdfs:Container ; rdfs:member data5g:FiveMinuteReportEventCoordination_COstubTps ] .
`;

  const result = applyPostprocessor({
    text: intent,
    context: {
      userPrompt:
        "Deploy rusty-llm with symmetric coordination between token throughput and energy consumption",
    },
  });

  const parser = new Parser({ format: "text/turtle" });
  assert.doesNotThrow(() => {
    for (const _quad of parser.parse(result.text)) {
      // drain parser
    }
  });
  assert.doesNotMatch(result.text, /\bdata5g:COstubTps\b/);
  assert.doesNotMatch(result.text, /\bdata5g:COstubEnergy\b/);
});

test("applyPostprocessor reuses compute and network latency conditions for coordination", () => {
  const intent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COcompute .

data5g:NE1 a data5g:NetworkExpectation ;
    icm:target data5g:network-slice ;
    log:allOf data5g:COnetwork .

data5g:COcompute a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-computelatency_COcompute ;
        quan:smaller [ quan:unit "ms" ; rdf:value 15 ]
    ] .

data5g:COnetwork a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:networklatency_COnetwork ;
        quan:smaller [ quan:unit "ms" ; rdf:value 5 ]
    ] .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COstubCompute, data5g:COstubNetwork ;
    data5g:coordinates data5g:DE1, data5g:NE1 .

data5g:COstubCompute a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-computelatency_COstubCompute ] .

data5g:COstubNetwork a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:networklatency_COstubNetwork ] .
`;

  const result = applyPostprocessor({
    text: intent,
    context: {
      userPrompt: "symmetric coordination between compute latency and network latency",
    },
  });

  assert.match(result.text, /log:allOf data5g:COcompute, data5g:COnetwork/);
  assert.doesNotMatch(result.text, /\bdata5g:COstubCompute\b/);
  assert.doesNotMatch(result.text, /\bdata5g:COstubNetwork\b/);
  assert.match(result.text, /data5g:U_arg_p99-computelatency/);
  assert.match(result.text, /data5g:U_arg_networklatency/);
});

function assertParseableTurtle(text: string): void {
  const parser = new Parser({ format: "text/turtle" });
  assert.doesNotThrow(() => {
    for (const _quad of parser.parse(text)) {
      // drain parser
    }
  });
}

test("normalizeCoordinationUtility repairs malformed ut:utility U_coord links on CE", () => {
  const base = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:DE1 a data5g:DeploymentExpectation ;
    log:allOf data5g:COtps .
data5g:SE1 a data5g:SustainabilityExpectation ;
    log:allOf data5g:COenergy .
data5g:COtps a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_COtps ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
    ] .
data5g:COenergy a icm:Condition ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ quan:unit "J" ; rdf:value 50 ]
    ] .
`;

  const malformedUtilityLinks = [
    `data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COtps, data5g:COenergy ;
    data5g:coordinates data5g:DE1, data5g:SE1 ;
    ut:utility data5g:U_coord`,
    `data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COtps, data5g:COenergy ;
    data5g:coordinates data5g:DE1, data5g:SE1 ;
    ut:utility data5g:U_coord .`,
    `data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COtps, data5g:COenergy ;
    data5g:coordinates data5g:DE1, data5g:SE1 ;
    <http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/utility> data5g:U_coord`,
    `data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf
        data5g:COtps,
        data5g:COenergy .
    data5g:coordinates data5g:DE1, data5g:SE1 ;
    ut:utility data5g:U_coord .`,
  ];

  for (const ceFragment of malformedUtilityLinks) {
    const result = normalizeCoordinationUtility({
      text: `${base}\n${ceFragment}`,
      flags: { coordinationSymmetric: true },
      userText: "symmetric coordination on token throughput and energy consumption",
    });
    assert.match(result.text, /ut:utility data5g:U_coord(?:_[0-9a-f]+)?\s*;/);
    assert.doesNotMatch(result.text, /ut:utility data5g:U_coord(?:_[0-9a-f]+)?\s*$/m);
    assertParseableTurtle(result.text);
  }
});

test("user coordination guide exists", () => {
  const doc = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../docs/coordination-using-utility-function.md"),
    "utf8",
  );
  assert.match(doc, /create intent using intentGen/);
  assert.match(doc, /symmetric coordination/);
});

test("normalizeCoordinationUtility emits weighted profile with 0.7/0.3 limits", () => {
  const turtle = `data5g:COtps a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COtps ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .
data5g:COenergy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:power-consumption_COenergy ;
            quan:smaller [ quan:unit "W" ; rdf:value 50 ] ] .
data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COtps .
data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COenergy .
data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COtps, data5g:COenergy ;
    data5g:coordinates data5g:DE1, data5g:SE1 ;
    ut:utility data5g:U_coord .`;

  const result = normalizeCoordinationUtility({
    text: turtle,
    flags: { coordinationWeighted: true },
    userText:
      "weighted coordination prioritizing token throughput over energy consumption",
  });
  assert.match(result.text, /utilityFn_weighted(?:_[0-9a-f]+)?/);
  assert.match(result.text, /"0\.7"\^\^xsd:decimal/);
  assert.match(result.text, /"0\.3"\^\^xsd:decimal/);
  assert.match(result.text, /mf:poly/);
  assert.match(result.text, /fun:arityMin 2 ; fun:arityMax 2/);
});

test("normalizeCoordinationUtility removes cross-profile utility pollution before rebuild", () => {
  const polluted =
    SAMPLE_CE +
    `
data5g:U_coord a ut:UtilityInformation ;
    ut:function data5g:utilityFn_symmetric ;
    ut:utilityProfile data5g:UP_coord .

data5g:UP_coord a ut:UtilityProfile ;
    ut:minUtility "0.0"^^xsd:decimal ;
    ut:maxUtility "1.0"^^xsd:decimal .

data5g:utilityFn_symmetric a fun:function ;
    fun:argumentNames ( data5g:U_arg_a data5g:U_arg_b ) ;
    fun:arityMin 2 ; fun:arityMax 2 ;
    rdf:value [ quan:sum () ] .

data5g:utilityFn_weighted a fun:function ;
    fun:argumentNames ( data5g:U_arg_a data5g:U_arg_b ) ;
    fun:arityMin 2 ; fun:arityMax 2 ;
    rdf:value [ quan:sum () ] .
`;

  const result = normalizeCoordinationUtility({
    text: polluted,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination",
  });

  assert.doesNotMatch(result.text, /utilityFn_weighted(?:_[0-9a-f]+)?\s+a/);
  assert.equal((result.text.match(/ut:forMetric/g) ?? []).length, 2);
  assert.equal((result.text.match(/quan:sum/g) ?? []).length, 1);
  assert.match(result.text, /utilityFn_symmetric(?:_[0-9a-f]+)?/);
});

test("normalizeCoordinationUtility emits intent-scoped UI/UP/UN locals for canonical intent uuid", () => {
  const intentUuid = "37aa3663a5fe43ae824657843cb0caa2";
  const turtle = SAMPLE_CE.replace("data5g:I1 a icm:Intent ;", `data5g:I${intentUuid} a icm:Intent ;`).replace(
    "log:allOf data5g:COtps, data5g:COenergy .",
    "log:allOf data5g:COtps, data5g:COenergy ;\n    ut:utility data5g:U_coord .",
  );

  const result = normalizeCoordinationUtility({
    text: turtle,
    flags: { coordinationSymmetric: true },
    userText: "symmetric coordination on token throughput and energy consumption",
  });

  assert.match(result.text, new RegExp(`ut:utility data5g:UI${intentUuid}`));
  assert.match(result.text, new RegExp(`\\bdata5g:UP${intentUuid}\\s+a\\s+ut:UtilityProfile`));
  assert.match(result.text, new RegExp(`\\bdata5g:UN${intentUuid}\\s+a\\s+fun:function`));
  assert.doesNotMatch(result.text, /\bdata5g:U_coord(?:_[0-9a-f]+)?\s+a\b/);
  assert.doesNotMatch(result.text, /\butilityFn_symmetric(?:_[0-9a-f]+)?\s+a\b/);
});
