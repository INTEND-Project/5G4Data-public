import test from "node:test";
import assert from "node:assert/strict";
import { ObservationTool } from "../tools/observationTool.js";

test("ObservationTool uses valuesOfTargetProperty local name as compound metric", () => {
  const turtle = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:COe8af1c5b33734c109cf68d0025998898 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COe8af1c5b33734c109cf68d0025998898 ] .`;

  const tool = new ObservationTool();
  const metric = tool.parseConditionMetrics(turtle)[0];
  assert.equal(metric?.compoundMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
  const payload = tool.generateObservation(metric!, 42, "2026-01-01T00:00:00Z");
  assert.equal(payload.observedMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
});
