import assert from "node:assert/strict";
import test from "node:test";
import { buildCodegenRetryMessage, buildCodegenSystemPrompt, envelopeSnippet } from "../tools/syntheticLlmCodegen.js";
import { parseDdMmYyyyUtc, parseSyntheticPrompt, normalizeSyntheticIntentId } from "../tools/syntheticPrompt.js";

test("parseDdMmYyyyUtc parses UTC", () => {
  const d = parseDdMmYyyyUtc("01.05.2026 12:30:00");
  assert.equal(d?.toISOString(), "2026-05-01T12:30:00.000Z");
});

test("parseDdMmYyyyUtc parses UTC with dotted clock (hh.mm.ss)", () => {
  const d = parseDdMmYyyyUtc("17.05.2026 05.00.00");
  assert.equal(d?.toISOString(), "2026-05-17T05:00:00.000Z");
});


test("normalizeSyntheticIntentId accepts I-prefixed and bare hex", () => {
  assert.equal(
    normalizeSyntheticIntentId("I6be57670fcad46fba1f648ad28b9cdb5"),
    "I6be57670fcad46fba1f648ad28b9cdb5",
  );
  assert.equal(
    normalizeSyntheticIntentId("6be57670fcad46fba1f648ad28b9cdb5"),
    "I6be57670fcad46fba1f648ad28b9cdb5",
  );
  assert.equal(
    normalizeSyntheticIntentId("d0c6b67abd4449a5ac6599ccc05af796"),
    "Id0c6b67abd4449a5ac6599ccc05af796",
  );
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

test("buildCodegenSystemPrompt appends cumulative module when instructions request running total", () => {
  const gaugeInstructions =
    "default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily variation and low noise. " +
    "During stress periodes between 08:00-09:00 and 16:00-17:00 create dips down to between 200-300";
  const gauge = buildCodegenSystemPrompt(
    gaugeInstructions,
    "p99-token-target_COf12213b4cd81427a897fa77bfa7b9d59"
  );
  const cumulative = buildCodegenSystemPrompt("monotonically increasing cumulative counter start at 100");

  assert.match(gauge, /### Gauge per-tick sampling codegen/u);
  assert.match(gauge, /### Stress-period dip episodes codegen/u);
  assert.doesNotMatch(gauge, /### Cumulative counter codegen/u);
  assert.doesNotMatch(gauge.split("### Gauge per-tick")[0] ?? gauge, /loop i=1\.\.ctx\.tickIndex/u);
  assert.doesNotMatch(gauge.split("### Gauge per-tick")[0] ?? gauge, /accumulation loop stepIndex/u);
  assert.match(gauge, /Gauge sampling: return the current reading only/u);

  assert.match(cumulative, /### Cumulative counter codegen/u);
  assert.doesNotMatch(cumulative, /### Gauge per-tick sampling codegen/u);
  assert.match(cumulative, /ctx\.uniformForStep\(i\)/u);
  assert.match(cumulative, /never decrease/u);
  assert.match(cumulative, /Counter sampling/u);
});

test("buildCodegenSystemPrompt appends gauge module for baseline range instructions", () => {
  const baseline = buildCodegenSystemPrompt("baseline 50-80 with daily variation");
  assert.match(baseline, /### Gauge per-tick sampling codegen/u);
  assert.doesNotMatch(baseline, /### Cumulative counter codegen/u);
});

test("buildCodegenRetryMessage guides cumulative fixes for monotonic failures", () => {
  const message = buildCodegenRetryMessage(
    "Generated snippet decreases between tick 0 and tick 1",
    {
      fullUserPrompt: "cumulative counter",
      intentId: "I1",
      compoundMetric: "energy-consumption_COabc",
      kgUnitResolved: "J",
      instructionsSlice: "monotonically increasing cumulative counter start at 10",
      mode: "historic",
      frequencySeconds: 300,
    },
  );
  assert.match(message, /uniformForStep/i);
  assert.doesNotMatch(message, /per-tick gauge sample for the current tick only/i);
});

test("enrichCodegenContextSlice adds samplingKind and appendedModules", async () => {
  const { enrichCodegenContextSlice } = await import("../tools/syntheticLlmCodegen.js");
  const enriched = enrichCodegenContextSlice({
    fullUserPrompt: "x",
    intentId: "I1",
    compoundMetric: "p99-token-target_COabc",
    kgUnitResolved: "NA",
    instructionsSlice: "keep values in the 500-1000 range",
    mode: "historic",
    frequencySeconds: 60
  });
  assert.equal(enriched.samplingKind, "gauge");
  assert.deepEqual(enriched.appendedModules, ["gauge_codegen"]);
});
