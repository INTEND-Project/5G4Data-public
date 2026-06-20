import assert from "node:assert/strict";
import test from "node:test";

import { resolveObservationStorageTypes } from "../tools/resolveObservationStorage.js";

test("resolveObservationStorageTypes prefers session override", () => {
  const ids = resolveObservationStorageTypes({
    sessionOverride: "prometheus",
    intentDestinations: ["graphdb"],
    createIntentStorage: "graphdb"
  });
  assert.deepEqual(ids, ["prometheus"]);
});

test("resolveObservationStorageTypes uses intent destinations when no override", () => {
  const ids = resolveObservationStorageTypes({
    intentDestinations: ["prometheus"],
    createIntentStorage: "graphdb"
  });
  assert.deepEqual(ids, ["prometheus"]);
});

test("resolveObservationStorageTypes falls back to create-intent storage", () => {
  const ids = resolveObservationStorageTypes({
    createIntentStorage: "prometheus"
  });
  assert.deepEqual(ids, ["prometheus"]);
});

test("resolveObservationStorageTypes defaults to graphdb", () => {
  assert.deepEqual(resolveObservationStorageTypes({}), ["graphdb"]);
});
