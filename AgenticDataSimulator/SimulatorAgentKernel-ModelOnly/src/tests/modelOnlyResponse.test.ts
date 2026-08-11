import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureTurtlePrefixes,
  formatModelOnlyResponse,
  formatShaclSection,
  looksLikeModelOnlyTurtle
} from "../core/modelOnlyResponse.js";
import { parseStopSequencesEnv } from "../config.js";

test("parseStopSequencesEnv accepts JSON array", () => {
  assert.deepEqual(parseStopSequencesEnv('["<|im_start|>","<|im_end|>"]'), [
    "<|im_start|>",
    "<|im_end|>"
  ]);
});

test("parseStopSequencesEnv accepts newline list", () => {
  assert.deepEqual(parseStopSequencesEnv("<|im_start|>\n<|im_end|>"), [
    "<|im_start|>",
    "<|im_end|>"
  ]);
});

test("formatModelOnlyResponse includes dual SHACL sections after turtle", () => {
  const text = formatModelOnlyResponse({
    turtleOrText: "@prefix data5g: <http://5g4data.eu/5g4data#> .\ndata5g:I a icm:Intent .",
    isTurtle: true,
    tioResult: { conforms: true, reportText: "Conforms.", violations: [] },
    data5gResult: {
      conforms: false,
      reportText: "1. missing property",
      violations: [{ message: "missing property" }]
    }
  });
  assert.match(text, /@prefix data5g:/);
  assert.match(text, /## SHACL validation/);
  assert.match(text, /### TIO/);
  assert.match(text, /conforms: true/);
  assert.match(text, /### 5g4data/);
  assert.match(text, /conforms: false/);
  assert.match(text, /missing property/);
});

test("formatModelOnlyResponse skips SHACL when not turtle", () => {
  const text = formatModelOnlyResponse({
    turtleOrText: "Please clarify the workload.",
    isTurtle: false,
    tioResult: null,
    data5gResult: null
  });
  assert.match(text, /Please clarify the workload/);
  assert.match(text, /conforms: skipped/);
});

test("formatShaclSection skipped reason", () => {
  const section = formatShaclSection("TIO", null, "no shapes");
  assert.match(section, /### TIO/);
  assert.match(section, /conforms: skipped/);
  assert.match(section, /no shapes/);
});

test("looksLikeModelOnlyTurtle accepts intent without @prefix", () => {
  const body =
    'data5g:I152a524d1a47489784e58a028f3da403 a icm:Intent ;\n  imo:handler data5g:inServ .';
  assert.equal(looksLikeModelOnlyTurtle(body), true);
  const withPrefix = ensureTurtlePrefixes(body);
  assert.match(withPrefix, /@prefix data5g:/);
  assert.match(withPrefix, /icm:Intent/);
});
