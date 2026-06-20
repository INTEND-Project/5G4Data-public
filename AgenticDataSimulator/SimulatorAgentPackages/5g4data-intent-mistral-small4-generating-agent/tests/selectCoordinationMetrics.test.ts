import test from "node:test";
import assert from "node:assert/strict";
import type { IntentDraft } from "../tools/assembleIntent.js";
import {
  selectCoordinationConditionsFromPool,
  selectCoordinationMetrics
} from "../tools/selectCoordinationMetrics.js";
import { normalizeCoordinationUtility } from "../tools/postprocess/coordinationUtility.js";
import type { ParsedCoordinationCondition } from "../tools/postprocess/coordinationUtilityDerive.js";

const deploymentThroughput = `data5g:CO_DE_1 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_CO_DE_1 ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .
data5g:DE_1 a data5g:DeploymentExpectation ;
    log:allOf data5g:CO_DE_1 .`;

const sustainabilityDualEnergy = `data5g:CO_SE_PWR a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:power-consumption_CO_SE_PWR ;
            quan:smaller [ quan:unit "W" ; rdf:value 50 ] ] .
data5g:CO_SE_ENERGY a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_CO_SE_ENERGY ;
            quan:smaller [ quan:unit "MJ" ; rdf:value 100 ] ] .
data5g:SE_1 a data5g:SustainabilityExpectation ;
    log:allOf data5g:CO_SE_PWR, data5g:CO_SE_ENERGY .`;

const networkLatency = `data5g:CO_NE_LAT a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:networklatency_CO_NE_LAT ;
            quan:smaller [ quan:unit "ms" ; rdf:value 5 ] ] .
data5g:NE_1 a data5g:NetworkExpectation ;
    log:allOf data5g:CO_NE_LAT .`;

function draft(fragments: IntentDraft["fragments"]): IntentDraft {
  return { intentDescription: "test", fragments };
}

test("Tromsø regression selects throughput + one energy CO (N=2)", () => {
  const locals = selectCoordinationMetrics({
    draft: draft([
      { id: "deployment", turtle: deploymentThroughput, locals: ["CO_DE_1"] },
      { id: "sustainability", turtle: sustainabilityDualEnergy, locals: ["CO_SE_PWR", "CO_SE_ENERGY"] }
    ]),
    userPrompt:
      "Deploy a small llm with symmetric coordination on token throughput and energy consumption"
  });
  assert.equal(locals.length, 2);
  assert.ok(locals.includes("CO_DE_1"));
  assert.equal(locals.filter((l) => l.startsWith("CO_SE")).length, 1);
});

test("dual energy stems in catalogue yield one energy CO", () => {
  const locals = selectCoordinationMetrics({
    draft: draft([{ id: "sustainability", turtle: sustainabilityDualEnergy, locals: [] }]),
    userPrompt: "coordinate energy consumption"
  });
  assert.equal(locals.length, 1);
  assert.match(locals[0]!, /^CO_SE_/);
});

test("three-way coordination selects one CO per active expectation kind (N=3)", () => {
  const locals = selectCoordinationMetrics({
    draft: draft([
      { id: "deployment", turtle: deploymentThroughput, locals: [] },
      { id: "sustainability", turtle: sustainabilityDualEnergy, locals: [] },
      { id: "network", turtle: networkLatency, locals: [] }
    ]),
    userPrompt: "coordinate deployment, sustainability, and network"
  });
  assert.equal(locals.length, 3);
});

test("generic symmetric coordination picks DE + SE when both present", () => {
  const locals = selectCoordinationMetrics({
    draft: draft([
      { id: "deployment", turtle: deploymentThroughput, locals: [] },
      { id: "sustainability", turtle: sustainabilityDualEnergy, locals: [] }
    ]),
    userPrompt: "symmetric coordination"
  });
  assert.equal(locals.length, 2);
  assert.ok(locals.includes("CO_DE_1"));
});

test("explicit energy + power prompt selects both sustainability COs", () => {
  const locals = selectCoordinationMetrics({
    draft: draft([{ id: "sustainability", turtle: sustainabilityDualEnergy, locals: [] }]),
    userPrompt:
      "weighted coordination prioritizing energy consumption over power consumption"
  });
  assert.equal(locals.length, 2);
  assert.ok(locals.includes("CO_SE_ENERGY"));
  assert.ok(locals.includes("CO_SE_PWR"));
});

test("selectCoordinationConditionsFromPool keeps energy and power when both named", () => {
  const pool: ParsedCoordinationCondition[] = [
    {
      local: "COenergy",
      metricStem: "energy-consumption",
      metricLocal: "data5g:energy-consumption_COenergy",
      quantifier: "smaller",
      threshold: 100,
      unit: "MJ"
    },
    {
      local: "COpower",
      metricStem: "power-consumption",
      metricLocal: "data5g:power-consumption_COpower",
      quantifier: "smaller",
      threshold: 50,
      unit: "W"
    }
  ];
  const selected = selectCoordinationConditionsFromPool(
    pool,
    "weighted coordination prioritizing energy consumption over power consumption"
  );
  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((c) => c.metricStem).sort(),
    ["energy-consumption", "power-consumption"]
  );
});

test("normalizeCoordinationUtility emits 0.7/0.3 for explicit energy over power", () => {
  const turtle = `${sustainabilityDualEnergy}
data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:CO_SE_ENERGY, data5g:CO_SE_PWR ;
    data5g:coordinates data5g:SE_1 ;
    ut:utility data5g:U_coord .`;

  const result = normalizeCoordinationUtility({
    text: turtle,
    flags: { coordinationWeighted: true },
    userText:
      "weighted coordination prioritizing energy consumption over power consumption"
  });
  assert.match(result.text, /utilityFn_weighted(?:_[0-9a-f]+)?/);
  assert.match(result.text, /"0\.7"\^\^xsd:decimal/);
  assert.match(result.text, /"0\.3"\^\^xsd:decimal/);
  assert.match(result.text, /fun:arityMin 2 ; fun:arityMax 2/);
});

test("normalizeCoordinationUtility keeps distinct power and energy CO locals in CE", () => {
  const turtle = `${sustainabilityDualEnergy}
data5g:CE1 a data5g:CoordinationExpectation ;
    icm:target data5g:coordination-service ;
    log:allOf data5g:CO_SE_PWR, data5g:CO_SE_ENERGY ;
    data5g:coordinates data5g:SE_1 ;
    ut:utility data5g:U_coord .`;

  const result = normalizeCoordinationUtility({
    text: turtle,
    flags: { coordinationWeighted: true },
    userText:
      "weighted coordination prioritizing power consumption over energy consumption"
  });
  assert.match(result.text, /log:allOf data5g:CO_SE_PWR, data5g:CO_SE_ENERGY/);
  assert.doesNotMatch(result.text, /log:allOf data5g:CO_SE_PWR, data5g:CO_SE_PWR/);
});
