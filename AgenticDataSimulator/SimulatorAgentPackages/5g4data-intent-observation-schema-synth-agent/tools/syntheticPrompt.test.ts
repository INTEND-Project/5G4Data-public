import assert from "node:assert/strict";
import test from "node:test";
import { extractInstructionGlobals } from "./schemaSynth/parseGlobals.js";
import { parseSyntheticPrompt } from "./syntheticPrompt.js";

const CONTROLLER_P99 =
  "`intent_id=I522bf0c1d5dc41e387216472778c3e0f`, `mode=historic`, `start=21.05.2026 05:00:00`, " +
  "`stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target_COa0612960dfcc4235b771afc9aa5afc9d`, " +
  "default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily " +
  "variation and low noise. During stress periodes between 08:00-09:00 and 16:00-17:00 create dips down to " +
  "between 200-300 for periods lasting between 3-10 minutes, at least two dips per stress periode";

test("parseSyntheticPrompt Contoller metric tick does not leave orphan leading backtick", () => {
  const r = parseSyntheticPrompt(CONTROLLER_P99);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.metricSlices.length, 1);
  const text = r.value.metricSlices[0]?.instructionsText ?? "";
  assert.notEqual(text[0], "`");
  assert.match(text, /700-1500/);
  assert.match(text, /stress/i);
});

test("orchestrator-style instructionsForMap keeps NL prose for LLM mapping", () => {
  const r = parseSyntheticPrompt(CONTROLLER_P99);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const slice = r.value.metricSlices[0]!;
  const instructionsForMap = [
    slice.instructionsText,
    "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, " +
      "`frequency=60s`, `metric=" +
      slice.metricCompound +
      "`"
  ].join(" ");
  const g = extractInstructionGlobals(instructionsForMap);
  assert.match(g.prose, /700-1500/);
  assert.match(g.prose, /stress/i);
  assert.deepEqual(g.metrics, [slice.metricCompound]);
  assert.equal(g.mode, "historic");
});

test("extractInstructionGlobals ignores orphan backtick when stripping prose", () => {
  const broken =
    "`, default range is between 700-1500 stress dips. " +
    "`mode=historic`, `metric=p99-token-target_COa0612960dfcc4235b771afc9aa5afc9d`";
  const g = extractInstructionGlobals(broken);
  assert.match(g.prose, /700-1500/);
  assert.match(g.prose, /stress/);
  assert.equal(g.mode, "historic");
  assert.deepEqual(g.metrics, ["p99-token-target_COa0612960dfcc4235b771afc9aa5afc9d"]);
});
