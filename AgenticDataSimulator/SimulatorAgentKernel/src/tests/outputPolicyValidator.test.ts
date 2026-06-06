import test from "node:test";
import assert from "node:assert/strict";
import {
  collectOutputIssues,
  extractTurtlePayload,
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

test("collectOutputIssues flags missing catalogue workload for deployment turtle", () => {
  const issues = collectOutputIssues({
    text: `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://example/icm/> .
data5g:I11112222333344445555666677778888 a icm:Intent .
data5g:DE11112222333344445555666677778888 a data5g:DeploymentExpectation .`,
    runtimeContext: "Runtime without workload block",
    intentFlags: { deployment: true, locality: false, networkQos: false, sustainability: true },
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(
    issues.some((i) => i.includes("[selected workload objectives]")),
  );
});

test("extractTurtlePayload strips narration before and between turtle blocks", () => {
  const text = `Here's the final Turtle intent:

@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://example/icm/> .
Here's the deployment expectation block.
data5g:I11112222333344445555666677778888 a icm:Intent .
Let me know if you need changes.`;
  const extracted = extractTurtlePayload(text);
  assert.doesNotMatch(extracted, /Here's/i);
  assert.doesNotMatch(extracted, /Let me know/i);
  assert.match(extracted, /@prefix data5g:/);
  assert.match(extracted, /data5g:I11112222333344445555666677778888 a icm:Intent/);
});

test("collectOutputIssues accepts turtle wrapped in narration", () => {
  const text = `Here's the corrected intent:

@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
data5g:I11112222333344445555666677778888 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;
  const issues = collectOutputIssues({
    text,
    runtimeContext: "runtime",
    intentFlags: { deployment: false, locality: false, networkQos: false },
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent", "imo:handler \"inServ\"", "imo:owner \"inChat\""],
      conditionalRequirements: []
    }
  });
  assert.equal(issues.some((i) => i.includes("Turtle syntax is invalid")), false);
});

test("collectOutputIssues flags invalid turtle syntax", () => {
  const issues = collectOutputIssues({
    text: `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://example/icm/> .
data5g:I11112222333344445555666677778888 a icm:Intent .
data5g:utilityFn_symmetric a fun:Function ;
    fun:aggregates (`,
    runtimeContext: "runtime",
    intentFlags: { deployment: false, locality: false, networkQos: false },
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(issues.some((i) => i.includes("Turtle syntax is invalid")));
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

