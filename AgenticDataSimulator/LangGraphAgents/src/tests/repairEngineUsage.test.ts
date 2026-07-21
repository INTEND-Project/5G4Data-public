import test from "node:test";
import assert from "node:assert/strict";
import { RepairEngine } from "../core/repairEngine.js";
import { loadDomainPackage } from "../core/packageLoader.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/LangGraphAgents/packages/5g4data-intent-langgraph-generating-agent";

test("repairEngine returns usage calls for repair invocation", async () => {
  const engine = new RepairEngine(async () => ({
    text: "icm:Intent icm:ReportingExpectation",
    call: {
      stage: "repair",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      temperature: 1,
      temperatureSent: true,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      latencyMs: 10,
      usageKnown: true
    }
  }));
  const domainPackage = loadDomainPackage(basePackageDir);

  const result = await engine.repairIfNeeded(
    "I will proceed with data5g:I<uuid4>",
    {
      runtimeContext: "runtime",
      intentFlags: { deployment: false, locality: false, networkQos: false },
      validatorRules: {
        forbiddenPhrases: ["<uuid4>", "i will proceed"],
        requiredTokens: ["icm:Intent"],
        conditionalRequirements: []
      },
      domainPackage
    },
    ["system block"],
    [{ role: "user", content: "hello" }]
  );

  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.stage, "repair");
});

test("repairEngine postprocesses repaired turtle placeholders before final validation", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const repairedTurtle = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <https://tmforum.org/icm#> .
@prefix log: <https://tmforum.org/log#> .
data5g:I__ID_INTENT_1__ a icm:Intent ;
  log:allOf data5g:DE__ID_DEPLOYMENT_1__, data5g:SE__ID_SUSTAINABILITY_1__, data5g:CE__ID_COORDINATION_1__, data5g:CO__ID_CONDITION_P99_1__ .
data5g:DE__ID_DEPLOYMENT_1__ a icm:DeploymentExpectation .
data5g:SE__ID_SUSTAINABILITY_1__ a icm:SustainabilityExpectation .
data5g:CE__ID_COORDINATION_1__ a data5g:CoordinationExpectation .
data5g:CO__ID_CONDITION_P99_1__ a icm:Condition .
data5g:RE__ID_REPORT_DEPLOYMENT_1__ a icm:ReportingExpectation .
data5g:RE__ID_REPORT_SUSTAINABILITY_1__ a icm:ReportingExpectation .
data5g:RE__ID_REPORT_COORDINATION_1__ a icm:ReportingExpectation .`;

  const engine = new RepairEngine(async () => ({
    text: repairedTurtle,
    call: {
      stage: "repair",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      temperature: 1,
      temperatureSent: true,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      latencyMs: 10,
      usageKnown: true
    }
  }));

  const result = await engine.repairIfNeeded(
    "I will proceed with placeholder ids",
    {
      runtimeContext: "runtime",
      intentFlags: {
        deployment: true,
        locality: false,
        networkQos: false,
        sustainability: true,
        coordination: true
      },
      validatorRules: domainPackage.validatorRules,
      domainPackage
    },
    ["system block"],
    [{ role: "user", content: "generate intent" }]
  );

  assert.equal(result.text.includes("__ID_"), false);
  assert.equal(result.text.includes("UUIDv4-derived"), false);
  assert.ok(result.debug.some((line) => line.includes("postprocessor_applied=uuid-localname-fix")));
});

test("repairEngine strips narration from repaired turtle before validation", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const repairedTurtle = `Here's the repaired intent:

@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
data5g:Ia1b2c3d4e5f6478890abcdef12345678 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .
data5g:REa1b2c3d4e5f6478890abcdef12345679 a icm:ObservationReportingExpectation .`;

  const engine = new RepairEngine(async () => ({
    text: repairedTurtle,
    call: {
      stage: "repair",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      temperature: 1,
      temperatureSent: true,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      latencyMs: 10,
      usageKnown: true
    }
  }));

  const result = await engine.repairIfNeeded(
    "I will proceed with placeholder ids",
    {
      runtimeContext: "runtime",
      intentFlags: { deployment: false, locality: false, networkQos: false },
      validatorRules: {
        forbiddenPhrases: ["<uuid4>", "i will proceed"],
        requiredTokens: [
          "icm:Intent",
          "icm:ObservationReportingExpectation",
          "imo:handler \"inServ\"",
          "imo:owner \"inChat\""
        ],
        conditionalRequirements: []
      },
      domainPackage
    },
    ["system block"],
    [{ role: "user", content: "generate intent" }]
  );

  assert.doesNotMatch(result.text, /Here's/i);
  assert.match(result.text, /@prefix data5g:/);
});

test("repairEngine returns review fallback instead of hard error before confirmation", async () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const engine = new RepairEngine(async () => ({
    text: `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://example/icm/> .
data5g:I11112222333344445555666677778888 a icm:Intent .`,
    call: {
      stage: "repair",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
      temperature: 1,
      temperatureSent: true,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      latencyMs: 10,
      usageKnown: true
    }
  }));

  const reviewFallback = `Extracted deployment objectives
- p99-token-target: threshold=400
Type OK to confirm generation of Turtle.`;

  const result = await engine.repairIfNeeded(
    reviewFallback,
    {
      runtimeContext: "runtime",
      intentFlags: { deployment: true, locality: true, networkQos: false, sustainability: true },
      validatorRules: domainPackage.validatorRules,
      domainPackage,
      confirmationAck: false
    },
    ["system block"],
    [{ role: "user", content: "generate intent" }]
  );

  assert.doesNotMatch(result.text, /I cannot produce a valid final Turtle intent yet/);
  assert.match(result.text, /Type OK to confirm generation of Turtle/i);
});
