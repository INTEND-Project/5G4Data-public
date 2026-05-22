import assert from "node:assert/strict";
import test from "node:test";
import { envelopeSnippet } from "../tools/syntheticLlmCodegen.js";
import { parseDdMmYyyyUtc, parseSyntheticPrompt } from "../tools/syntheticPrompt.js";

test("parseDdMmYyyyUtc parses UTC", () => {
  const d = parseDdMmYyyyUtc("01.05.2026 12:30:00");
  assert.equal(d?.toISOString(), "2026-05-01T12:30:00.000Z");
});

test("parseDdMmYyyyUtc parses UTC with dotted clock (hh.mm.ss)", () => {
  const d = parseDdMmYyyyUtc("17.05.2026 05.00.00");
  assert.equal(d?.toISOString(), "2026-05-17T05:00:00.000Z");
});

test("parseSyntheticPrompt historic accepts dotted timestamps", () => {
  const text =
    "`intent_id=I6be57670fcad46fba1f648ad28b9cdb5`, `mode=historic`, `frequency=60s`, " +
    "`start=17.05.2026 05.00.00`, `stop=18.05.2026 05.00.00`. `metric=detection_latency_CO9f3788fd0ec040edb680c1f854ba944a` instructions.";
  const r = parseSyntheticPrompt(text);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.mode, "historic");
  assert.equal(r.value.historicStart?.toISOString(), "2026-05-17T05:00:00.000Z");
  assert.equal(r.value.historicEnd?.toISOString(), "2026-05-18T05:00:00.000Z");
});

test("parseSyntheticPrompt splits metrics and globals", () => {
  const text =
    "`intent_id=I9088ff61b8594773bbaad6f608bfc497`, `mode=streaming`, `frequency=60s`. " +
    "`metric=bandwidth_COd89281fd7d9e496f8e2c90addcb3f36d` baseline 50-80. " +
    "`metric=networklatency_COafdaeb27b9a047d78920350c482bfe33` latency 15-40ms.";
  const r = parseSyntheticPrompt(text);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.intentId, "I9088ff61b8594773bbaad6f608bfc497");
  assert.equal(r.value.mode, "streaming");
  assert.equal(r.value.frequencySeconds, 60);
  assert.equal(r.value.metricSlices.length, 2);
  assert.match(r.value.metricSlices[0]?.instructionsText ?? "", /baseline/iu);
});

test("envelopeSnippet parses JSON fenced output", () => {
  const raw = "```json\n" + '{"snippet":"return 42;"}' + "\n```";
  assert.equal(envelopeSnippet(raw)?.trim(), "return 42;");
});
