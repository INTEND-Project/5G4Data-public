import test from "node:test";
import assert from "node:assert/strict";
import { loadDomainPackage } from "../core/packageLoader.js";
import { runConfiguredPostprocessors } from "../core/postprocessorRunner.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/IntentAgent/OpenClawPackages/5g4data-intent-generation";

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
