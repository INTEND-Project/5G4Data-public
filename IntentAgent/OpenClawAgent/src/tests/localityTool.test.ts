import test from "node:test";
import assert from "node:assert/strict";
import { bboxPolygonWkt, extractLocalityPhrase, haversineKm } from "../tools/localityTool.js";

test("extractLocalityPhrase parses near expression", () => {
  const phrase = extractLocalityPhrase("Deploy close to Trondheim for low latency.");
  assert.equal(phrase, "Trondheim for low latency.");
});

test("haversine computes zero distance for same coordinates", () => {
  assert.equal(haversineKm(59.9, 10.7, 59.9, 10.7), 0);
});

test("bboxPolygonWkt returns closed polygon", () => {
  const polygon = bboxPolygonWkt(59.91, 10.75);
  assert.ok(polygon.startsWith("POLYGON(("));
  assert.ok(polygon.endsWith("))"));
});
