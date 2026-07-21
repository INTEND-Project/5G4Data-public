import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPostprocessor,
  DEFAULT_NETWORK_BANDWIDTH_MBPS,
  DEFAULT_NETWORK_LATENCY_MS
} from "../tools/postprocess/networkDefaults.js";

test("networkDefaults fills missing bandwidth and latency thresholds", () => {
  const input = `
data5g:NE1 a data5g:NetworkExpectation ;
    log:allOf data5g:CObw, data5g:COlat .

data5g:CObw a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_CObw ;
            quan:larger [ quan:unit "mbit/s" ; rdf:value 0.0 ] ] .

data5g:COlat a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:latency_COlat ;
            quan:smaller [ quan:unit "ms" ] ] .
`.trim();

  const result = applyPostprocessor({ text: input });
  assert.ok(result.changes > 0);
  assert.match(result.text, new RegExp(`rdf:value ${DEFAULT_NETWORK_BANDWIDTH_MBPS}`));
  assert.match(result.text, new RegExp(`rdf:value ${DEFAULT_NETWORK_LATENCY_MS}`));
});

test("networkDefaults leaves explicit non-zero thresholds unchanged", () => {
  const input = `
data5g:NE1 a data5g:NetworkExpectation ;
    log:allOf data5g:CObw .

data5g:CObw a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_CObw ;
            quan:larger [ quan:unit "mbit/s" ; rdf:value 500.0 ] ] .
`.trim();

  const result = applyPostprocessor({ text: input });
  assert.match(result.text, /rdf:value 500\.0/);
  assert.doesNotMatch(result.text, new RegExp(`rdf:value ${DEFAULT_NETWORK_BANDWIDTH_MBPS}`));
});
