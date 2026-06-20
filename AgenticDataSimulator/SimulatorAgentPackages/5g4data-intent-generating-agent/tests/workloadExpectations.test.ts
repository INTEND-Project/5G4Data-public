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
