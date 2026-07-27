import test from "node:test";
import assert from "node:assert/strict";
import { loadDomainPackage } from "../core/packageLoader.js";
import { runConfiguredPostprocessors } from "../core/postprocessorRunner.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/5g4data-intent-generating-agent";

test("configured package postprocessor rewrites placeholders and invalid uuid-like identifiers", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:I__ID_INTENT_1__ a icm:Intent ;
  log:allOf data5g:COdetection1a2b3c4d5e6f7a8b9c0, data5g:RG__ID_REGION_1__ .
data5g:COdetection1a2b3c4d5e6f7a8b9c0 a icm:Condition .
[] icm:valuesOfTargetProperty data5g:detection-latency_CO__ID_CONDITION_DETECTION_1__ .
data5g:RG__ID_REGION_1__ a geo:Feature .`;
  const debug: string[] = [];
  const text = await runConfiguredPostprocessors({
    text: input,
    context: {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: false, networkQos: false },
      validatorRules: domainPackage.validatorRules
    },
    domainPackage,
    when: "always",
    debug
  });
  assert.notEqual(text, input);
  assert.ok(debug.some((line) => line.includes("postprocessor_applied=uuid-localname-fix")));
  assert.equal(text.includes("__ID_"), false);
  assert.equal(text.includes("CO__ID_"), false);
  assert.ok(/data5g:detection-latency_CO[0-9a-f]{32}/.test(text));
  const regionIds = [...text.matchAll(/data5g:(RG[0-9a-f]{32})/g)].map((m) => m[1]);
  assert.ok(regionIds.length >= 2);
  assert.equal(regionIds[0], regionIds[1]);
});

test("postprocessor inserts CO prefix on valuesOfTargetProperty when LLM omits it", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:I__ID_INTENT_1__ a icm:Intent ;
  log:allOf data5g:CO__ID_CONDITION_P99_1__ .
data5g:CO__ID_CONDITION_P99_1__ a icm:Condition ;
  set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target___ID_CONDITION_P99_1__ ] .`;
  const text = await runConfiguredPostprocessors({
    text: input,
    context: {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: false, networkQos: false },
      validatorRules: domainPackage.validatorRules
    },
    domainPackage,
    when: "always",
    debug: []
  });
  assert.ok(/data5g:p99-token-target_CO[0-9a-f]{32}/.test(text));
  assert.ok(!/data5g:p99-token-target_[0-9a-f]{32}\b/.test(text));
  assert.equal(text.includes("__ID_"), false);
});

test("reporting-triggers postprocessor scopes global TenMinute events", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:DE0d1ce26a35b94f358117d671456b01e7 a data5g:DeploymentExpectation, icm:Expectation ;
  icm:target data5g:deployment ;
  log:allOf data5g:COc5f7b82460cf4207a5a93ca4183ccbdf .

data5g:tenMinutesDeployment a time:DurationDescription ;
  time:numericDuration "10"^^xsd:decimal ;
  time:unitType time:unitMinute .

data5g:TenMinuteReportEventDeployment a rdfs:Class ;
  rdfs:subClassOf imo:Event ;
  time:delay ( data5g:lastReportInstant data5g:tenMinutesDeployment ) ;
  imo:eventFor data5g:DE0d1ce26a35b94f358117d671456b01e7 .

data5g:RE97978a1a7e50424ebebfbed023838ba1 a icm:ObservationReportingExpectation ;
  icm:target data5g:deployment ;
  icm:reportTriggers [ a rdfs:Container ;
      rdfs:member data5g:TenMinuteReportEventDeployment ] .`;
  const debug: string[] = [];
  const text = await runConfiguredPostprocessors({
    text: input,
    context: {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: false, networkQos: false },
      validatorRules: domainPackage.validatorRules,
      reportingIntervalMinutes: 5
    },
    domainPackage,
    when: "always",
    debug
  });
  assert.ok(debug.some((line) => line.includes("postprocessor_applied=reporting-triggers")));
  assert.ok(/FiveMinuteReportEventDeployment_COc5f7b82460cf4207a5a93ca4183ccbdf/.test(text));
  assert.equal(/\bTenMinuteReportEventDeployment\b/.test(text), false);
});

test("reporting-triggers postprocessor uses unitSecond for reportingIntervalSeconds", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:DE0d1ce26a35b94f358117d671456b01e7 a data5g:DeploymentExpectation, icm:Expectation ;
  icm:target data5g:deployment ;
  log:allOf data5g:COc5f7b82460cf4207a5a93ca4183ccbdf .

data5g:TenMinuteReportEventDeployment a rdfs:Class ;
  rdfs:subClassOf imo:Event ;
  time:delay ( data5g:lastReportInstant data5g:tenMinutesDeployment ) ;
  imo:eventFor data5g:DE0d1ce26a35b94f358117d671456b01e7 .

data5g:RE97978a1a7e50424ebebfbed023838ba1 a icm:ObservationReportingExpectation ;
  icm:target data5g:deployment ;
  icm:reportTriggers [ a rdfs:Container ;
      rdfs:member data5g:TenMinuteReportEventDeployment ] .`;
  const debug: string[] = [];
  const text = await runConfiguredPostprocessors({
    text: input,
    context: {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: false, networkQos: false },
      validatorRules: domainPackage.validatorRules,
      reportingIntervalSeconds: 60
    },
    domainPackage,
    when: "always",
    debug
  });
  assert.ok(/SixtySecondReportEventDeployment_COc5f7b82460cf4207a5a93ca4183ccbdf/.test(text));
  assert.ok(/time:numericDuration "60"[\s\S]*time:unitType time:unitSecond/.test(text));
});

test("postprocessor resolves lowercase placeholders and CO-prefixed metric forms from LLM", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:I__ID_INTENT_1__ a icm:Intent ;
  log:allOf data5g:CO__ID_CONDITION_p99_token_target_1__,
        data5g:CO__ID_CONDITION_container_cpu_joules_total_1__,
        data5g:CO__ID_CONDITION_container_cpu_watts_1__ .
data5g:CO__ID_CONDITION_p99_token_target_1__ a icm:Condition ;
  set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_CO__ID_CONDITION_p99_token_target_1__ ] .
data5g:CO__ID_CONDITION_container_cpu_joules_total_1__ a icm:Condition ;
  set:forAll [ icm:valuesOfTargetProperty data5g:container_cpu_joules_total_CO__ID_CONDITION_container_cpu_joules_total_1__ ] .
data5g:CO__ID_CONDITION_container_cpu_watts_1__ a icm:Condition ;
  set:forAll [ icm:valuesOfTargetProperty data5g:container_cpu_watts_CO__ID_CONDITION_container_cpu_watts_1__ ] .`;
  const text = await runConfiguredPostprocessors({
    text: input,
    context: {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: false, networkQos: false, sustainability: true },
      validatorRules: domainPackage.validatorRules
    },
    domainPackage,
    when: "always",
    debug: []
  });
  assert.equal(text.includes("__ID_"), false);
  assert.ok(/data5g:p99-token-target_CO[0-9a-f]{32}/.test(text));
  assert.ok(/data5g:container_cpu_joules_total_CO[0-9a-f]{32}/.test(text));
  assert.ok(/data5g:container_cpu_watts_CO[0-9a-f]{32}/.test(text));
  const p99Cond = text.match(/data5g:(CO[0-9a-f]{32}) a icm:Condition ;\s*\n\s*set:forAll \[ icm:valuesOfTargetProperty data5g:p99-token-target_(CO[0-9a-f]{32})/)?.[1];
  const p99Metric = text.match(/data5g:p99-token-target_(CO[0-9a-f]{32})/)?.[1];
  assert.equal(p99Cond, p99Metric);
});

const mistralSmall4PackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/5g4data-intent-mistral-small4-generating-agent";

test("mistral-small4 postprocessor dedupes duplicate valuesOfTargetProperty in set:forAll", async () => {
  const domainPackage = loadDomainPackage(mistralSmall4PackageDir);
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .

data5g:I__ID_INTENT_1__ a icm:Intent ;
    log:allOf data5g:DE__ID_DEPLOYMENT_1__ .

data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO__ID_CONDITION_1__ .

data5g:CO__ID_CONDITION_1__ a icm:Condition ;
    dct:description "p99-token-target condition quan:larger: 400 token/s" ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target___ID_CONDITION_1__ ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
        ], [
        icm:valuesOfTargetProperty data5g:p99-token-target___ID_CONDITION_1__ ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
        ] .`;
  const debug: string[] = [];
  const text = await runConfiguredPostprocessors({
    text: input,
    context: {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: false, networkQos: false },
      validatorRules: domainPackage.validatorRules
    },
    domainPackage,
    when: "always",
    debug
  });
  assert.ok(debug.some((line) => line.includes("postprocessor_applied=turtle-collection-dedupe")));
  assert.equal([...text.matchAll(/valuesOfTargetProperty/gi)].length, 1);
  assert.equal(text.includes("__ID_"), false);
});
