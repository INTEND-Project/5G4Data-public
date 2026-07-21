import test from "node:test";
import assert from "node:assert/strict";
import { applyPostprocessor } from "../tools/postprocess/workloadExpectations.js";

const runtimeContext = `[selected workload objectives]
Selected chart: rusty-llm (version 0.1.19)
Deployment objective defaults from values.yaml objectives:
- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint)
Sustainability objective defaults from values.yaml sustainability:
- energy-consumption: threshold=50 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=J (source=tmf-unit-hint)

[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "EC_31" .\``;

const sustainablePrompt =
  "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner";

test("workloadExpectations scaffolds DE/SE/CX from runtime context", () => {
  const partial = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .

data5g:I11112222333344445555666677778888 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;

  const result = applyPostprocessor({
    text: partial,
    context: {
      intentFlags: { deployment: true, sustainability: true, locality: true },
      runtimeContext,
      userPrompt: sustainablePrompt,
      reportingIntervalSeconds: 60
    }
  });

  assert.ok(result.changes > 0);
  assert.match(result.text, /data5g:DeploymentExpectation/);
  assert.match(result.text, /data5g:SustainabilityExpectation/);
  assert.match(result.text, /data5g:DataCenter "EC_31"/);
  assert.match(result.text, /icm:ObservationReportingExpectation/);
});

test("workloadExpectations scaffold includes prometheus destinations when requested", () => {
  const partial = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I11112222333344445555666677778888 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;

  const scaffolded = applyPostprocessor({
    text: partial,
    context: {
      intentFlags: {
        deployment: true,
        sustainability: true,
        locality: true,
        reportToPrometheus: true
      },
      runtimeContext: `${runtimeContext}\nObservation report storage for this intent: prometheus.`,
      userPrompt: sustainablePrompt,
      reportingIntervalSeconds: 60
    }
  }).text;

  assert.match(scaffolded, /data5g:DeploymentExpectation/);
  assert.match(scaffolded, /data5g:SustainabilityExpectation/);
  assert.match(scaffolded, /data5g:DataCenter "EC_31"/);
  assert.match(scaffolded, /data5g:prometheus/);
  assert.match(scaffolded, /icm:ObservationReportingExpectation/);
});

test("workloadExpectations replaces data-center placeholder when runtime has EC binding", () => {
  const turtle = `data5g:CX1 a icm:Context ;
    data5g:DataCenter "<data-center>" ;
    data5g:Application "object detection" .`;

  const result = applyPostprocessor({
    text: turtle,
    context: {
      intentFlags: { deployment: true },
      runtimeContext,
      userPrompt: "deploy near Bodø",
      reportingIntervalSeconds: 60,
    },
  });

  assert.match(result.text, /data5g:DataCenter "EC_31"/);
  assert.doesNotMatch(result.text, /<data-center>/);
});

const avalancheLikeIntent = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I37b11953d491474a8fe25ee2eba42f3e a icm:Intent ;
    log:allOf data5g:DE22ae4f08e4a4481b93373c054c51dacb,
        data5g:NE7e57f3c8bfe646b187db4d754d93cc53,
        data5g:RE4f7abca629324cf9a37b81ad53a6f49b .

data5g:DE22ae4f08e4a4481b93373c054c51dacb a data5g:DeploymentExpectation,
    icm:Expectation,
    icm:IntentElement ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO1528fa96bc7b4b39bf5e1d73d1e0fc66 .

data5g:NE7e57f3c8bfe646b187db4d754d93cc53 a data5g:NetworkExpectation,
    icm:Expectation,
    icm:IntentElement ;
    icm:target data5g:network-slice ;
    log:allOf data5g:COaff7c3b489f3498d872fc58a818d6f0d,
        data5g:COb04cc544f4f34e01870e3981cfef64a4 .

data5g:RE4f7abca629324cf9a37b81ad53a6f49b a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ;
        rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
        rdfs:member data5g:SixtySecondReportEventDeployment_CO1528fa96bc7b4b39bf5e1d73d1e0fc66 ] .`;

test("workloadExpectations adds network RE when NetworkExpectation exists without network-slice reporting", () => {
  const result = applyPostprocessor({
    text: avalancheLikeIntent,
    context: {
      intentFlags: { networkQos: true, reportToPrometheus: true },
      runtimeContext: "Observation report storage for this intent: prometheus.",
      reportingIntervalSeconds: 60,
    },
  });

  assert.ok(result.changes > 0);
  assert.match(result.text, /icm:target data5g:network-slice/u);
  assert.match(result.text, /SixtySecondReportEventNetwork_COaff7c3b489f3498d872fc58a818d6f0d/u);
  assert.match(result.text, /durationNetwork_COaff7c3b489f3498d872fc58a818d6f0d/u);
  assert.match(result.text, /imo:eventFor data5g:NE7e57f3c8bfe646b187db4d754d93cc53/u);
  assert.match(result.text, /rdfs:member data5g:prometheus/u);
  assert.match(result.text, /log:allOf[\s\S]*data5g:RE4f7abca629324cf9a37b81ad53a6f49b[\s\S]*data5g:RE[0-9a-f]{32}/u);
});

test("workloadExpectations leaves intent unchanged when network RE already exists", () => {
  const withNetworkRe = `${avalancheLikeIntent}

data5g:REnetwork1 a icm:ObservationReportingExpectation ;
    icm:target data5g:network-slice ;
    icm:reportDestinations [ a rdfs:Container ;
        rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
        rdfs:member data5g:SixtySecondReportEventNetwork_COaff7c3b489f3498d872fc58a818d6f0d ] .`;

  const result = applyPostprocessor({
    text: withNetworkRe,
    context: { intentFlags: { networkQos: true } },
  });

  assert.equal(result.changes, 0);
});
