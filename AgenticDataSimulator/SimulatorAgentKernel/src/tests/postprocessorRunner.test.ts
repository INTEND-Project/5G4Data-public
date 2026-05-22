import test from "node:test";
import assert from "node:assert/strict";
import { loadDomainPackage } from "../core/packageLoader.js";
import { runConfiguredPostprocessors } from "../core/postprocessorRunner.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/5g4data-intent-generation";

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
