import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMetricStem,
  normalizeConditionScopedMetricNamesFromCatalogue,
  parseMetricStemsFromRuntimeContext
} from "../tools/metricNaming.js";
import { applyPostprocessor } from "../tools/postprocess/uuidFix.js";

const runtimeContext = `[selected workload objectives]
Selected chart: rusty-llm (version 0.1.19)
Deployment objective defaults from values.yaml objectives:
- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint), measuredBy=intend/p99token
Sustainability objective defaults from values.yaml sustainability:
- energy-consumption: threshold=50 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=J (source=tmf-unit-hint), measuredBy=intend/energy-consumption`;

test("parseMetricStemsFromRuntimeContext reads values.yaml objective names", () => {
  const stems = parseMetricStemsFromRuntimeContext(runtimeContext);
  assert.deepEqual(stems, ["p99-token-target", "energy-consumption"]);
});

test("canonicalMetricStem maps underscore variants to catalogue hyphen stems", () => {
  const stems = parseMetricStemsFromRuntimeContext(runtimeContext);
  assert.equal(canonicalMetricStem("p99_token_target", stems), "p99-token-target");
  assert.equal(canonicalMetricStem("energy_consumption", stems), "energy-consumption");
});

test("postprocessor normalizes valuesOfTargetProperty using catalogue stems from runtime context", () => {
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:I__ID_INTENT_1__ a icm:Intent ;
  log:allOf data5g:CO__ID_CONDITION_P99_1__ .
data5g:CO__ID_CONDITION_P99_1__ a icm:Condition ;
  dct:description "p99-token-target condition quan:smaller: 400" ;
  set:forAll [ icm:valuesOfTargetProperty data5g:p99_token_target___ID_CONDITION_P99_1__ ] .`;

  const { text } = applyPostprocessor({
    text: input,
    context: { runtimeContext, validatorRules: {} }
  });
  assert.match(text, /data5g:p99-token-target_CO[0-9a-f]{32}/);
  assert.ok(!/data5g:p99_token_target_CO/.test(text));
});

test("normalizeConditionScopedMetricNamesFromCatalogue leaves unmatched stems unchanged", () => {
  const turtle = "set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_COabc1234567890123456789012345678 ] .";
  const out = normalizeConditionScopedMetricNamesFromCatalogue(turtle, runtimeContext);
  assert.equal(out, turtle);
});

test("postprocessor normalizes using dct:description stems when catalogue lines are absent from runtime context", () => {
  const input = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:CO__ID_CONDITION_P99_1__ a icm:Condition ;
  dct:description "p99-token-target condition quan:smaller: 400" ;
  set:forAll [ icm:valuesOfTargetProperty data5g:p99_token_target_CO8a2ee50e254443f1963db6a70ff9729a ] .`;

  const { text } = applyPostprocessor({
    text: input,
    context: { runtimeContext: "Runtime grounding context without catalogue objectives", validatorRules: {} }
  });
  assert.match(text, /data5g:p99-token-target_CO8a2ee50e254443f1963db6a70ff9729a/);
});

test("postprocessor normalizes using explicit knownMetricStems from runtime", () => {
  const input = "set:forAll [ icm:valuesOfTargetProperty data5g:p99_token_target_CO8a2ee50e254443f1963db6a70ff9729a ] .";
  const { text } = applyPostprocessor({
    text: input,
    context: {
      runtimeContext: "",
      knownMetricStems: ["p99-token-target"],
      validatorRules: {}
    }
  });
  assert.match(text, /data5g:p99-token-target_CO8a2ee50e254443f1963db6a70ff9729a/);
});

