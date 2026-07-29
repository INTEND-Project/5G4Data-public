import test from "node:test";
import assert from "node:assert/strict";
import { applyPostprocessor } from "../tools/postprocess/tioIdioms.js";

const PREFIXES = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
`;

test("tioIdioms injects icm:Target for referenced targets and types expectations", () => {
  const input = `${PREFIXES}
data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1, data5g:RE1 .

data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment .

data5g:RE1 a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment .
`;

  const result = applyPostprocessor({ text: input, context: {} });
  assert.ok(result.changes > 0);
  assert.match(result.text, /data5g:deployment a icm:Target \./);
  assert.match(
    result.text,
    /data5g:DE1 a data5g:DeploymentExpectation,\s*icm:Expectation,\s*icm:IntentElement\s*;/
  );
});

test("tioIdioms is idempotent when idioms already present", () => {
  const input = `${PREFIXES}
data5g:deployment a icm:Target .

data5g:I1 a icm:Intent ;
    log:allOf data5g:DE1 .

data5g:DE1 a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:deployment .
`;

  const result = applyPostprocessor({ text: input, context: {} });
  assert.equal(result.changes, 0);
  assert.equal(result.text.match(/data5g:deployment a icm:Target \./g)?.length, 1);
});

test("tioIdioms skips non-turtle review text", () => {
  const result = applyPostprocessor({
    text: "Type OK to confirm generation of Turtle.",
    context: {}
  });
  assert.equal(result.changes, 0);
});
