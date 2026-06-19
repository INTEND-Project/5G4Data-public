import test from "node:test";
import assert from "node:assert/strict";
import { graphDbPersistEligibility } from "../core/turnOrchestrator.js";

const TURTLE = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
data5g:I00000000000000000000000000000001 a icm:Intent .`;

test("graphDbPersistEligibility persists only on conformant synthesis turn", () => {
  const base = {
    text: TURTLE,
    confirmationAck: true,
    shaclConforms: true,
    noGraphDb: false
  };
  assert.deepEqual(graphDbPersistEligibility(base), { eligible: true });
});

test("graphDbPersistEligibility skips turn 1 (no confirmation ack)", () => {
  assert.deepEqual(
    graphDbPersistEligibility({
      text: TURTLE,
      confirmationAck: false,
      shaclConforms: true,
      noGraphDb: false
    }),
    { eligible: false, skipReason: "not_synthesis_turn" }
  );
});

test("graphDbPersistEligibility skips SHACL non-conformance", () => {
  assert.deepEqual(
    graphDbPersistEligibility({
      text: TURTLE,
      confirmationAck: true,
      shaclConforms: false,
      noGraphDb: false
    }),
    { eligible: false, skipReason: "shacl_nonconformant" }
  );
});

test("graphDbPersistEligibility skips response with SHACL failure marker", () => {
  assert.deepEqual(
    graphDbPersistEligibility({
      text: `${TURTLE}\n\n# SHACL validation result`,
      confirmationAck: true,
      shaclConforms: true,
      noGraphDb: false
    }),
    { eligible: false, skipReason: "shacl_nonconformant" }
  );
});

test("graphDbPersistEligibility skips when NO_GRAPHDB", () => {
  assert.deepEqual(
    graphDbPersistEligibility({
      text: TURTLE,
      confirmationAck: true,
      shaclConforms: true,
      noGraphDb: true
    }),
    { eligible: false, skipReason: "no_graphdb" }
  );
});
