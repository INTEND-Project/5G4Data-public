import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ShaclValidatorTool } from "../../../SimulatorAgentKernel/src/core/shaclValidatorTool.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const shapesFile = join(pkgRoot, "validation/skill_subset_intent_shapes.ttl");
const fixturesDir = join(pkgRoot, "validation/fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

test("i16 bad datacenter label violates EC clusterId pattern", async () => {
  const validator = new ShaclValidatorTool(shapesFile);
  const result = await validator.validateTurtle(loadFixture("i16-bad-datacenter-label.ttl"));
  assert.equal(result.conforms, false);
  const messages = result.violations.map((v) => v.message).join("\n");
  assert.match(messages, /edge cluster id/i);
});

test("i16 bad utility arity violates CE metric count vs fun:arityMax", async () => {
  const validator = new ShaclValidatorTool(shapesFile);
  const result = await validator.validateTurtle(loadFixture("i16-bad-utility-arity.ttl"));
  assert.equal(result.conforms, false);
});

test("i18 bad DE duration violates expectation duration ban", async () => {
  const validator = new ShaclValidatorTool(shapesFile);
  const result = await validator.validateTurtle(loadFixture("i18-bad-de-duration.ttl"));
  assert.equal(result.conforms, false);
  const messages = result.violations.map((v) => v.message).join("\n");
  assert.match(messages, /numericDuration|unitType/i);
});

test("i18 bad dual rdf:value on utility function fails SHACL", async () => {
  const validator = new ShaclValidatorTool(shapesFile);
  const result = await validator.validateTurtle(loadFixture("i18-bad-dual-rdf-value.ttl"));
  assert.equal(result.conforms, false);
});

test("network expectation with blank-node set:forAll passes bandwidth/latency SPARQL checks", async () => {
  const validator = new ShaclValidatorTool(shapesFile);
  const turtle = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dct: <http://purl.org/dc/terms/> .

data5g:I1 a icm:Intent ;
    dct:description "test network intent" ;
    imo:handler "inServ" ;
    imo:owner "inChat" ;
    log:allOf data5g:NE1, data5g:RE1 .

data5g:NE1 a data5g:NetworkExpectation ;
    icm:target data5g:network-slice ;
    log:allOf data5g:CObw, data5g:COlat .

data5g:CObw a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_CObw ;
            quan:larger [ quan:unit "mbit/s" ; rdf:value 300 ] ] .

data5g:COlat a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:latency_COlat ;
            quan:smaller [ quan:unit "ms" ; rdf:value 50 ] ] .

data5g:RE1 a icm:ObservationReportingExpectation ;
    icm:target data5g:network-slice ;
    icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ; rdfs:member data5g:Evt1 ] .

data5g:Evt1 a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:Dur1 ) ;
    imo:eventFor data5g:NE1 .

data5g:Dur1 a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .
`.trim();
  const result = await validator.validateTurtle(turtle);
  assert.equal(result.conforms, true, result.reportText);
});
