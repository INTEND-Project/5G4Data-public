import test from "node:test";
import assert from "node:assert/strict";
import {
  collectOutputIssues,
  looksLikeTurtleIntent
} from "../core/outputPolicyValidator.js";

test("looksLikeTurtleIntent detects intent payload", () => {
  const text = "@prefix data5g: <http://5g4data.eu/5g4data#> .\ndata5g:I1 a icm:Intent .";
  assert.equal(looksLikeTurtleIntent(text), true);
});

test("collectOutputIssues flags placeholders", () => {
  const issues = collectOutputIssues({
    text: "I will proceed and create data5g:I<uuid4>",
    runtimeContext: "runtime",
    intentFlags: { deployment: true, locality: false, networkQos: false },
    validatorRules: {
      forbiddenPhrases: ["<uuid4>", "i will proceed"],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(issues.length > 0);
});

test("collectOutputIssues flags non-uuid4 local names", () => {
  const issues = collectOutputIssues({
    text: `@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:I11112222333344445555666677778888 a icm:Intent .
data5g:COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Condition .`,
    runtimeContext: "runtime",
    intentFlags: { deployment: false, locality: false, networkQos: false },
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(issues.some((i) => i.includes("UUIDv4-derived")));
});

