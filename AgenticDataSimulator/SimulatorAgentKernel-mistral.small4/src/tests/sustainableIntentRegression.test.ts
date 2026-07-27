import test from "node:test";
import assert from "node:assert/strict";
import { loadDomainPackage } from "../core/packageLoader.js";
import { collectOutputIssues } from "../core/outputPolicyValidator.js";
import { runConfiguredPostprocessors } from "../core/postprocessorRunner.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/5g4data-intent-generating-agent";

const runtimeContext = `[selected workload objectives]
Selected chart: rusty-llm (version 0.1.19)
Deployment objective defaults from values.yaml objectives:
- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint)
Sustainability objective defaults from values.yaml sustainability:
- energy-consumption: threshold=50 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=J (source=tmf-unit-hint)

[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "EC_31" .\`

Observation report storage for this intent: prometheus.`;

test("sustainable Tromsø prompt partial turtle passes policy after postprocessors on confirmation", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const partial = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .

data5g:I11112222333344445555666677778888 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;

  const debug: string[] = [];
  const postprocessed = await runConfiguredPostprocessors({
    text: partial,
    context: {
      runtimeContext,
      userPrompt:
        "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner",
      intentFlags: {
        deployment: true,
        sustainability: true,
        locality: true,
        networkQos: false,
        reportToPrometheus: true
      },
      validatorRules: domainPackage.validatorRules,
      reportingIntervalSeconds: 60
    },
    domainPackage,
    when: "always",
    debug
  });

  const issues = collectOutputIssues({
    text: postprocessed,
    runtimeContext,
    intentFlags: {
      deployment: true,
      sustainability: true,
      locality: true,
      networkQos: false,
      reportToPrometheus: true
    },
    confirmationAck: true,
    validatorRules: domainPackage.validatorRules
  });

  assert.equal(issues.length, 0, issues.join("\n"));
});
