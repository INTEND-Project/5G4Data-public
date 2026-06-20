import test from "node:test";
import assert from "node:assert/strict";
import { applyPostprocessor } from "../tools/postprocess/requiredPrefixes.js";

test("requiredPrefixes skips review summary that mentions quan: quantifiers", () => {
  const review = `Extracted deployment objectives
- p99-token-target: threshold=400 (source=value), quantifier=quan:larger (source=default), unit=tokens/s (source=unspecified)
- container_cpu_watts: threshold=50 (source=value), quantifier=quan:smaller (source=default), unit=watts (source=unspecified)

Type OK to confirm generation of Turtle.`;

  const result = applyPostprocessor({ text: review, context: {} });
  assert.equal(result.changes, 0);
  assert.equal(result.text, review);
  assert.equal(result.text.includes("@prefix quan:"), false);
});

test("requiredPrefixes injects quan: prefix into Turtle intent missing the declaration", () => {
  const turtle = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .

data5g:I11112222333344445555666677778888 a icm:Intent ;
    set:forAll [ icm:valuesOfTargetProperty data5g:metric_CO11112222333344445555666677778888 ] .

data5g:metric_CO11112222333344445555666677778888 quan:quantifier quan:larger .`;

  const result = applyPostprocessor({ text: turtle, context: {} });
  assert.ok(result.changes > 0);
  assert.match(result.text, /@prefix quan: <http:\/\/tio\.models\.tmforum\.org\/tio\/v3\.6\.0\/QuantityOntology\/> \./);
  assert.match(result.text, /@prefix set: /);
});
