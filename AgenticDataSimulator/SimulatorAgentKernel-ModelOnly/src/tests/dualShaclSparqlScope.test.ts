import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ShaclValidatorTool } from "../core/shaclValidatorTool.js";

const packageValidation = join(
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages",
  "5g4data-intent-generating-agent-model-only",
  "validation"
);

/** DE + RE without icm:target — 5g4data coverage must fail; pure TIO must not emit that message. */
const DE_RE_MISSING_TARGET = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:inServ a imo:IntentManager .
data5g:inChat a imo:IntentManager .
data5g:deployment a icm:Target .
data5g:prometheus a icm:ReportDestination .

data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Intent ;
    dct:description "deploy only" ;
    imo:handler data5g:inServ ;
    imo:owner data5g:inChat ;
    log:allOf ( data5g:DEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb data5g:REcccccccccccccccccccccccccccccccc ) .

data5g:DEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:deployment ;
    log:allOf ( data5g:CXdddddddddddddddddddddddddddddddd ) .

data5g:CXdddddddddddddddddddddddddddddddd a icm:Context ;
    data5g:Application "small-llm-inference" ;
    data5g:DataCenter "EC_31" ;
    data5g:DeploymentDescriptor "https://example.com/chart" .

data5g:duration1 a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:Evt1 a imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:duration1 ) ;
    imo:eventFor data5g:DEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb .

data5g:REcccccccccccccccccccccccccccccccc a icm:ObservationReportingExpectation, icm:IntentElement ;
    dct:description "reports" ;
    icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ; rdfs:member data5g:Evt1 ] .
`;

const COVERAGE_MSG =
  "When deployment expectation is present, a reporting expectation targeting data5g:deployment must also be present in intent log:allOf.";

test("5g4data validator reports DE⇒RE coverage when RE lacks icm:target", async () => {
  const validator = new ShaclValidatorTool(join(packageValidation, "skill_subset_intent_shapes.ttl"), {
    applyCustomSparqlConstraints: true
  });
  const result = await validator.validateTurtle(DE_RE_MISSING_TARGET);
  assert.equal(result.conforms, false);
  assert.ok(result.violations.some((v) => v.message.includes(COVERAGE_MSG)));
  assert.ok(
    result.violations.some((v) => v.message.includes("ReportingExpectationTargetShape"))
  );
});

test("TIO validator does not apply 5g4data DE⇒RE coverage SPARQL", async () => {
  const validator = new ShaclValidatorTool(join(packageValidation, "tio_shapes_bundle.ttl"), {
    applyCustomSparqlConstraints: false
  });
  const result = await validator.validateTurtle(DE_RE_MISSING_TARGET);
  assert.ok(!result.violations.some((v) => v.message.includes(COVERAGE_MSG)));
});
