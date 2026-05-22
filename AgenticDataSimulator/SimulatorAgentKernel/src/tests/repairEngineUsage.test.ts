import test from "node:test";
import assert from "node:assert/strict";
import { RepairEngine } from "../core/repairEngine.js";
import { loadDomainPackage } from "../core/packageLoader.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/IntentAgent/OpenClawPackages/5g4data-intent-generation";

test("repairEngine returns usage calls for repair invocation", async () => {
  const engine = new RepairEngine(async () => ({
    text: "icm:Intent icm:ReportingExpectation",
    call: {
      stage: "repair",
      provider: "openai",
      model: "gpt-5.3-chat-latest",
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
