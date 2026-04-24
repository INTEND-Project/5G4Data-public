import test from "node:test";
import assert from "node:assert/strict";
import { collectOutputIssues, looksLikeTurtleIntent } from "../core/outputPolicyValidator.js";

test("looksLikeTurtleIntent detects intent payload", () => {
  const text = "@prefix data5g: <http://5g4data.eu/5g4data#> .\ndata5g:I1 a icm:Intent .";
  assert.equal(looksLikeTurtleIntent(text), true);
});

test("collectOutputIssues flags placeholders", () => {
  const issues = collectOutputIssues({
    text: "I will proceed and create data5g:I<uuid4>",
    userText: "deploy this model",
    runtimeContext: "runtime"
  });
  assert.ok(issues.length > 0);
});
