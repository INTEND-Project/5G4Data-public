import test from "node:test";
import assert from "node:assert/strict";
import { Parser } from "n3";
import { buildDeploymentFragment } from "../tools/buildDeploymentFragment.ts";

const RUNTIME = `Runtime grounding context:

[Workload catalogue]
[selected workload objectives]
Selected chart: rusty-llm (version 0.1.26)
Deployment objective defaults from values.yaml objectives:
- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint)
Sustainability objective defaults from values.yaml sustainability:
- power-consumption: threshold=50 (source=tmf-value-hint), quantifier=quan:smaller (source=tmf-quantifier-hint), unit=W (source=tmf-unit-hint)
- energy-consumption: threshold=100 (source=tmf-value-hint), quantifier=quan:smaller (source=tmf-quantifier-hint), unit=MJ (source=tmf-unit-hint)

[GraphDB]
Recommended nearest edge data center: EC_31

[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "EC_31" .\`
`;

const PREFIXES = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

test("buildDeploymentFragment throws when GraphDB datacenter is missing", () => {
  assert.throws(
    () =>
      buildDeploymentFragment({
        runtimeContext: `[selected workload objectives]
Selected chart: rusty-llm (version 0.1.26)
Deployment objective defaults from values.yaml objectives:
- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint)
[GraphDB]
GraphDB lookup failed.`,
        reportingIntervalHint: "- Reporting interval: 10 minute(s) (time:unitMinute).",
        userPrompt: "Deploy a small llm in a datacenter near Tromsø/Norway"
      }),
    /no data center in GraphDB context/
  );
});

test("buildDeploymentFragment emits parse-valid deployment-only Turtle", () => {
  const body = buildDeploymentFragment({
    runtimeContext: RUNTIME,
    reportingIntervalHint: "- Reporting interval: 10 minute(s) (time:unitMinute)."
  });

  assert.match(body, /data5g:CO__ID_CONDITION_1__ a icm:Condition/);
  assert.match(body, /set:forAll/);
  assert.match(body, /data5g:CX__ID_CONTEXT_1__ a icm:Context/);
  assert.match(body, /data5g:DataCenter "EC_31"/);
  assert.match(body, /data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation[^]*log:allOf[^.]*\./);
  assert.doesNotMatch(
    body,
    /data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation[^.]*time:numericDuration/s
  );
  assert.match(body, /TenMinuteReportEventDeployment_CO__ID_CONDITION_1__/);
  assert.match(body, /data5g:RE__ID_REPORTING_DEPLOYMENT_1__ a icm:ObservationReportingExpectation/);
  assert.doesNotMatch(body, /power-consumption/);
  assert.doesNotMatch(body, /intend:/);

  const parser = new Parser({ format: "text/turtle" });
  parser.parse(`${PREFIXES}\n${body}`);
});
