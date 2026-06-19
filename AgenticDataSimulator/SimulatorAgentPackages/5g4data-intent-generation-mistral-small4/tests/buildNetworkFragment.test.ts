import test from "node:test";
import assert from "node:assert/strict";
import { buildNetworkFragment } from "../tools/buildNetworkFragment.js";
import {
  DEFAULT_NETWORK_BANDWIDTH_MBPS,
  DEFAULT_NETWORK_LATENCY_MS
} from "../tools/postprocess/networkDefaults.js";

const deploymentWithCx = `data5g:CX__ID_CONTEXT_1__ a icm:Context ;
    data5g:Application "avalance-object-detection" ;
    data5g:DataCenter "EC_31" .

data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation ;
    log:allOf data5g:CX__ID_CONTEXT_1__ .`;

test("buildNetworkFragment emits bandwidth and latency conditions with defaults", () => {
  const body = buildNetworkFragment({
    draft: {
      intentDescription: "test",
      fragments: [
        {
          id: "deployment",
          turtle: deploymentWithCx,
          locals: ["CX__ID_CONTEXT_1__", "DE__ID_DEPLOYMENT_1__"]
        }
      ]
    },
    reportingIntervalHint: "Reporting interval: 10 minutes."
  });

  assert.match(body, /data5g:NetworkExpectation/);
  assert.match(body, /data5g:bandwidth_CO__ID_CONDITION_BANDWIDTH_1__/);
  assert.match(body, /data5g:latency_CO__ID_CONDITION_LATENCY_1__/);
  assert.doesNotMatch(body, /data5g:Bandwidth_/);
  assert.doesNotMatch(body, /data5g:Latency_/);
  assert.match(body, new RegExp(`rdf:value ${DEFAULT_NETWORK_BANDWIDTH_MBPS}`));
  assert.match(body, new RegExp(`rdf:value ${DEFAULT_NETWORK_LATENCY_MS}`));
  assert.match(body, /icm:target data5g:network-slice/);
  assert.match(body, /data5g:CX__ID_CONTEXT_1__/);
});
