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
    confirmationAck: true,
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
    confirmationAck: true,
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
    confirmationAck: true,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(issues.some((i) => i.includes("Turtle syntax is invalid")));
});

test("collectOutputIssues skips turtle policy before user confirmation", () => {
  const issues = collectOutputIssues({
    text: `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://example/icm/> .
data5g:I11112222333344445555666677778888 a icm:Intent .`,
    runtimeContext: "runtime",
    intentFlags: { deployment: true, locality: true, networkQos: false, sustainability: true },
    confirmationAck: false,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent", "icm:ObservationReportingExpectation"],
      conditionalRequirements: [
        {
          intentFlag: "deployment",
          requiresAnyTokens: ["data5g:DeploymentExpectation"],
          error: "Deployment intent requires data5g:DeploymentExpectation."
        }
      ]
    }
  });
  assert.ok(
    issues.some((i) => i.includes("before user confirmation")),
  );
  assert.equal(issues.some((i) => i.includes("Deployment intent requires")), false);
});

test("collectOutputIssues rejects review summary after user confirmation", () => {
  const issues = collectOutputIssues({
    text: `Extracted deployment objectives
Type OK to confirm generation of Turtle.`,
    runtimeContext: "runtime",
    intentFlags: { deployment: true, locality: false, networkQos: false, sustainability: false },
    confirmationAck: true,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(issues.some((i) => i.includes("User confirmed generation")));
});

test("collectOutputIssues accepts review summary on first turn", () => {
  const issues = collectOutputIssues({
    text: `Extracted deployment objectives
- p99-token-target: threshold=400 (source=value)
Type OK to confirm generation of Turtle.`,
    runtimeContext: "[selected workload objectives]\n- p99-token-target: threshold=400",
    intentFlags: { deployment: true, locality: true, networkQos: false, sustainability: true },
    confirmationAck: false,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.equal(issues.length, 0);
});

test("extractTurtlePayload strips review markdown bullets between prefix blocks", () => {
  const text = `@prefix data5g: <http://5g4data.eu/5g4data#> .
- p99-token-target: threshold=400 (source=value)
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
data5g:I11112222333344445555666677778888 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;
  const extracted = extractTurtlePayload(text);
  assert.doesNotMatch(extracted, /p99-token-target: threshold/);
  const issues = collectOutputIssues({
    text,
    runtimeContext: "runtime",
    intentFlags: { deployment: false, locality: false, networkQos: false },
    confirmationAck: true,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent", "imo:handler \"inServ\"", "imo:owner \"inChat\""],
      conditionalRequirements: []
    }
  });
  assert.equal(issues.some((i) => i.includes("Turtle syntax is invalid")), false);
});

test("extractTurtlePayload preserves mf:logistic typed literal argument lines", () => {
  const text = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
data5g:I11112222333344445555666677778888 a icm:Intent .
data5g:utilityFn_symmetric a fun:function ;
    rdf:value [ quan:sum (
        [ mf:logistic ( data5g:U_arg_p99-token-target
                        "0.03"^^xsd:decimal
                        "0.5"^^xsd:decimal
                        "340"^^xsd:decimal );
          data5g:standardK "12"^^xsd:decimal ;
          data5g:x0Fraction "0.85"^^xsd:decimal ]
    ) ] .`;
  const extracted = extractTurtlePayload(text);
  assert.match(extracted, /"0\.03"\^\^xsd:decimal/);
  assert.match(extracted, /"340"\^\^xsd:decimal \);/);
  const issues = collectOutputIssues({
    text,
    runtimeContext: "runtime",
    intentFlags: { deployment: true, locality: false, networkQos: false, sustainability: true },
    confirmationAck: true,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.equal(issues.some((i) => i.includes("Turtle syntax is invalid")), false);
});

test("extractTurtlePayload strips partial markdown fences with preamble and closing prose", () => {
  const text = `Here is the TM Forum Turtle intent based on your specifications:

\`\`\`turtle
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
data5g:I11112222333344445555666677778888 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .
\`\`\`

This Turtle intent captures the deployment. If you need adjustments, let me know!`;
  const extracted = extractTurtlePayload(text);
  assert.doesNotMatch(extracted, /```/);
  assert.doesNotMatch(extracted, /Here is the TM Forum/i);
  assert.doesNotMatch(extracted, /let me know/i);
  assert.match(extracted, /@prefix data5g:/);
  assert.match(extracted, /data5g:I11112222333344445555666677778888 a icm:Intent/);
  const issues = collectOutputIssues({
    text,
    runtimeContext: "runtime",
    intentFlags: { deployment: false, locality: false, networkQos: false },
    confirmationAck: true,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent", "imo:handler \"inServ\"", "imo:owner \"inChat\""],
      conditionalRequirements: []
    }
  });
  assert.equal(issues.some((i) => i.includes("Turtle syntax is invalid")), false);
});

test("extractTurtlePayload preserves string literals containing backticks", () => {
  const text = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
data5g:I11112222333344445555666677778888 a icm:Intent ;
    dct:description "see \`\`\` example" .`;
  const extracted = extractTurtlePayload(text);
  assert.match(extracted, /"see \`\`\` example"/);
});

test("collectOutputIssues flags non-uuid4 local names", () => {
  const issues = collectOutputIssues({
    text: `@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:I11112222333344445555666677778888 a icm:Intent .
data5g:COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Condition .`,
    runtimeContext: "runtime",
    intentFlags: { deployment: false, locality: false, networkQos: false },
    confirmationAck: true,
    validatorRules: {
      forbiddenPhrases: [],
      requiredTokens: ["icm:Intent"],
      conditionalRequirements: []
    }
  });
  assert.ok(issues.some((i) => i.includes("UUIDv4-derived")));
});

