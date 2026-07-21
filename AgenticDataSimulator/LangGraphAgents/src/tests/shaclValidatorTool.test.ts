import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ShaclValidatorTool } from "../core/shaclValidatorTool.js";

const SHAPES_FILE = resolve(
  "packages/5g4data-intent-langgraph-generating-agent/validation/skill_subset_intent_shapes.ttl"
);

const CONFORMING_INTENT = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I1 a icm:Intent ;
    dct:description "Deploy rusty-llm near Tromso." ;
    imo:handler "inServ" ;
    imo:owner "inChat" ;
    log:allOf data5g:DE1,
        data5g:SE1,
        data5g:CE1,
        data5g:REdeploy,
        data5g:REsustain,
        data5g:REcoord .

data5g:COdeploy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:COpower a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:power-consumption_COpower ;
        quan:smaller [ quan:unit "W" ; rdf:value 50 ] ] .

data5g:COenergy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ quan:unit "MJ" ; rdf:value 100 ] ] .

data5g:COcoord1 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COcoord1 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:COcoord2 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COcoord2 ;
        quan:smaller [ quan:unit "MJ" ; rdf:value 100 ] ] .

data5g:CX1 a icm:Context ;
    data5g:Application "rusty-llm" ;
    data5g:DataCenter "EC_31" ;
    data5g:DeploymentDescriptor "https://example.invalid/rusty-llm/0.1.26" .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COdeploy, data5g:CX1 .

data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COpower, data5g:COenergy, data5g:CX1 .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COcoord1, data5g:COcoord2 ;
    ut:utility data5g:U1 .

data5g:U1 a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-token-target data5g:p99-token-target_COcoord1 ) ,
                 ( data5g:U_arg_energy-consumption data5g:energy-consumption_COcoord2 ) .

data5g:U_arg_p99-token-target a ut:UtilityArgument .
data5g:U_arg_energy-consumption a ut:UtilityArgument .

data5g:REdeploy a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment .

data5g:REsustain a icm:ObservationReportingExpectation ;
    icm:target data5g:sustainability .

data5g:REcoord a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service .
`;

test("ShaclValidatorTool accepts comma-separated log:allOf intents", async () => {
  const validator = new ShaclValidatorTool(SHAPES_FILE);
  const result = await validator.validateTurtle(CONFORMING_INTENT);
  assert.equal(result.conforms, true, result.reportText);
  assert.equal(result.violations.length, 0);
});

test("ShaclValidatorTool reports missing deployment reporting coverage", async () => {
  const validator = new ShaclValidatorTool(SHAPES_FILE);
  const intent = CONFORMING_INTENT.replace(
    "data5g:REdeploy a icm:ObservationReportingExpectation ;\n    icm:target data5g:deployment .\n\n",
    ""
  ).replace("data5g:REdeploy,\n        ", "");

  const result = await validator.validateTurtle(intent);
  assert.equal(result.conforms, false);
  assert.match(result.reportText, /deployment/i);
  assert.ok(result.violations.some((violation) => /deployment/i.test(violation.message)));
});

test("ShaclValidatorTool reports Turtle parse errors", async () => {
  const validator = new ShaclValidatorTool(SHAPES_FILE);
  const result = await validator.validateTurtle("this is not turtle");
  assert.equal(result.conforms, false);
  assert.match(result.reportText, /parse error/i);
});

test("ShaclValidatorTool accepts coordination anchor conditions without set:forAll", async () => {
  const intent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I1 a icm:Intent ;
    dct:description "Coordination intent." ;
    imo:handler "inServ" ;
    imo:owner "inChat" ;
    log:allOf data5g:DE1, data5g:SE1, data5g:CE1, data5g:REdeploy, data5g:REsustain, data5g:REcoord .

data5g:COdeploy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COdeploy ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:COenergy a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ quan:unit "MJ" ; rdf:value 100 ] ] .

data5g:COanchor1 a icm:Condition ;
    dct:description "coordination condition for p99-token-target" .

data5g:COanchor2 a icm:Condition ;
    dct:description "coordination condition for energy-consumption" .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COdeploy .

data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:COenergy .

data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:COdeploy, data5g:COenergy ;
    ut:utility data5g:U1 .

data5g:U1 a ut:UtilityInformation ;
    ut:forMetric ( data5g:U_arg_p99-token-target data5g:p99-token-target_COdeploy ) ,
                 ( data5g:U_arg_energy-consumption data5g:energy-consumption_COenergy ) .

data5g:U_arg_p99-token-target a ut:UtilityArgument .
data5g:U_arg_energy-consumption a ut:UtilityArgument .

data5g:REdeploy a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment .

data5g:REsustain a icm:ObservationReportingExpectation ;
    icm:target data5g:sustainability .

data5g:REcoord a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service .
`;

  const validator = new ShaclValidatorTool(SHAPES_FILE);
  const result = await validator.validateTurtle(intent);
  assert.equal(result.conforms, true, result.reportText);
});

test("ShaclValidatorTool reports missing shapes file", async () => {
  const validator = new ShaclValidatorTool("/tmp/does-not-exist-shapes.ttl");
  const result = await validator.validateTurtle(CONFORMING_INTENT);
  assert.equal(result.conforms, false);
  assert.match(result.reportText, /not found/i);
});
