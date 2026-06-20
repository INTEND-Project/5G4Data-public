import test from "node:test";
import assert from "node:assert/strict";
import {
  intentUtilityUuid,
  isCoordinationUtilityFunctionLocal,
  isCoordinationUtilityInfoLocal,
  isCoordinationUtilityProfileLocal,
  resolveCoordinationUtilityLocals,
} from "../tools/postprocess/intentUtilityLocals.js";

const INTENT_UUID = "37aa3663a5fe43ae824657843cb0caa2";
const INTENT_LOCAL = `I${INTENT_UUID}`;

test("intentUtilityUuid accepts canonical 32-hex intent locals", () => {
  assert.equal(intentUtilityUuid(INTENT_LOCAL), INTENT_UUID);
});

test("resolveCoordinationUtilityLocals scopes utility ids with full intent uuid", () => {
  const turtle = `data5g:${INTENT_LOCAL} a icm:Intent .`;
  const locals = resolveCoordinationUtilityLocals(turtle);
  assert.equal(locals.uInfo, `UI${INTENT_UUID}`);
  assert.equal(locals.uProfile, `UP${INTENT_UUID}`);
  assert.equal(locals.utilityFnLocal("symmetric"), `UN${INTENT_UUID}`);
  assert.equal(locals.utilityFnLocal("weighted"), `UN${INTENT_UUID}`);
});

test("resolveCoordinationUtilityLocals keeps legacy names without canonical intent uuid", () => {
  const locals = resolveCoordinationUtilityLocals("data5g:I1 a icm:Intent .");
  assert.equal(locals.uInfo, "U_coord");
  assert.equal(locals.uProfile, "UP_coord");
  assert.equal(locals.utilityFnLocal("symmetric"), "utilityFn_symmetric");
});

test("utility local matchers accept scoped and legacy names", () => {
  assert.ok(isCoordinationUtilityInfoLocal(`UI${INTENT_UUID}`));
  assert.ok(isCoordinationUtilityInfoLocal("U_coord"));
  assert.ok(isCoordinationUtilityProfileLocal(`UP${INTENT_UUID}`));
  assert.ok(isCoordinationUtilityProfileLocal("UP_coord"));
  assert.ok(isCoordinationUtilityFunctionLocal(`UN${INTENT_UUID}`));
  assert.ok(isCoordinationUtilityFunctionLocal("utilityFn_weighted"));
});
