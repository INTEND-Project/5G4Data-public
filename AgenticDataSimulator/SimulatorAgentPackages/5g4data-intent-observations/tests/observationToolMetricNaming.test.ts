import test from "node:test";
import assert from "node:assert/strict";
import {
  ObservationTool,
  baselineSpanFromCondition
} from "../tools/observationTool.js";
import { resolveStreamValueSpan } from "../tools/observationStreamCoordinator.js";
import { instructionsIncludeExplicitNumericRange } from "../tools/syntheticLlmCodegen.js";

test("ObservationTool uses valuesOfTargetProperty local name as compound metric", () => {
  const turtle = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:COe8af1c5b33734c109cf68d0025998898 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COe8af1c5b33734c109cf68d0025998898 ] .`;

  const tool = new ObservationTool();
  const metric = tool.parseConditionMetrics(turtle)[0];
  assert.equal(metric?.compoundMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
  const payload = tool.generateObservation(metric!, 42, "2026-01-01T00:00:00Z");
  assert.equal(payload.observedMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
});

test("baselineSpanFromCondition derives spans from quantifier", () => {
  const larger = baselineSpanFromCondition(400, "quan:larger");
  assert.equal(larger.minValue, 340);
  assert.equal(larger.maxValue, 460);

  const smaller = baselineSpanFromCondition(5000, "quan:smaller");
  assert.equal(smaller.minValue, 2500);
  assert.equal(smaller.maxValue, 4750);

  const fallback = baselineSpanFromCondition(undefined, undefined);
  assert.equal(fallback.minValue, 10);
  assert.equal(fallback.maxValue, 100);
});

test("parseReportableObservationStreams uses intent condition threshold and quantifier", () => {
  const turtle = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I1 a icm:Intent ;
  log:allOf data5g:DE1, data5g:RE1 .

data5g:CO1 a icm:Condition ;
  set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_CO1 ;
    quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:DE1 a data5g:DeploymentExpectation, icm:Expectation ;
  icm:target data5g:deployment ;
  log:allOf data5g:CO1 .

data5g:RE1 a icm:ObservationReportingExpectation ;
  icm:target data5g:deployment ;
  icm:reportTriggers [ rdfs:member data5g:TenMinuteReportEventDeployment ] .

data5g:tenMinutesDeployment a time:DurationDescription ;
  time:numericDuration "10"^^xsd:decimal ;
  time:unitType time:unitMinute .

data5g:TenMinuteReportEventDeployment a rdfs:Class ;
  time:delay ( data5g:lastReportInstant data5g:tenMinutesDeployment ) ;
  imo:eventFor data5g:DE1 .`;

  const tool = new ObservationTool();
  const stream = tool.parseReportableObservationStreams(turtle)[0];
  assert.equal(stream?.minValue, 340);
  assert.equal(stream?.maxValue, 460);
});

test("resolveStreamValueSpan prefers session override over derived baseline", () => {
  const stream = {
    reportingExpectationId: "RE1",
    targetLocalName: "deployment",
    conditionId: "CO1",
    targetProperty: "p99-token-target",
    compoundMetric: "p99-token-target_CO1",
    unit: "token/s",
    frequencySeconds: 600,
    minValue: 340,
    maxValue: 460,
    storageTypes: ["graphdb"] as const
  };
  const resolved = resolveStreamValueSpan(stream, { min: 30, max: 55 });
  assert.equal(resolved.min, 30);
  assert.equal(resolved.max, 55);
});

test("instructionsIncludeExplicitNumericRange detects explicit spans", () => {
  assert.equal(instructionsIncludeExplicitNumericRange("baseline 500-2000 during daytime"), true);
  assert.equal(instructionsIncludeExplicitNumericRange("keep values between 700 and 1500"), true);
  assert.equal(instructionsIncludeExplicitNumericRange("simulate daily variation"), false);
});
