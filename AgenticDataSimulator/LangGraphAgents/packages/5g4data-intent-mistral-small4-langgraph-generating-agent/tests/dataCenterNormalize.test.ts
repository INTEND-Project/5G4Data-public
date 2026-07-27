import test from "node:test";
import assert from "node:assert/strict";
import { applyPostprocessor } from "../tools/postprocess/dataCenterNormalize.js";

const RUNTIME = `[GraphDB]
Recommended nearest edge data center: EC_31
[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "EC_31" .\``;

test("dataCenterNormalize rewrites human label to GraphDB clusterId", () => {
  const text = `data5g:CX1 a icm:Context ;
    data5g:DataCenter "Tromsø Data Center" ;
    data5g:DeploymentDescriptor "https://example/chart" .`;
  const result = applyPostprocessor({ text, context: { runtimeContext: RUNTIME } });
  assert.equal(result.changes, 1);
  assert.match(result.text, /data5g:DataCenter "EC_31"/);
  assert.doesNotMatch(result.text, /Tromsø Data Center/);
});

test("dataCenterNormalize is idempotent when clusterId already correct", () => {
  const text = `data5g:CX1 a icm:Context ;
    data5g:DataCenter "EC_31" .`;
  const result = applyPostprocessor({ text, context: { runtimeContext: RUNTIME } });
  assert.equal(result.changes, 0);
});
