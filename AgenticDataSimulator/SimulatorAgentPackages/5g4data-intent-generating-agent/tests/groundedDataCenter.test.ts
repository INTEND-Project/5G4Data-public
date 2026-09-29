import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPostprocessor,
  extractGroundedDataCenter
} from "../tools/postprocess/groundedDataCenter.js";

test("extractGroundedDataCenter prefers locality binding over first DataCenter mention", () => {
  const runtime = `Recommended nearest edge data center: EC_31
Candidate edge data centers from GraphDB:
- EC_31 (69.6, 18.9)
- EC_1 (0, 0)

[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "EC_31" .\``;
  assert.equal(extractGroundedDataCenter(runtime), "EC_31");
});

test("groundedDataCenter overwrites wrong concrete DataCenter literals", () => {
  const turtle = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
data5g:CX1 a icm:Context ;
    data5g:DataCenter "EC_1" .
data5g:DE1 a data5g:DeploymentExpectation .
`;
  const runtime = `Recommended nearest edge data center: EC_31

[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "EC_31" .\``;
  const result = applyPostprocessor({ text: turtle, context: { runtimeContext: runtime } });
  assert.ok(result.changes > 0);
  assert.match(result.text, /data5g:DataCenter "EC_31"/);
  assert.doesNotMatch(result.text, /data5g:DataCenter "EC_1"/);
});
