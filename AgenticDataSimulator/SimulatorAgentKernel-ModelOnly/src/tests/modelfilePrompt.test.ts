import test from "node:test";
import assert from "node:assert/strict";
import { loadDomainPackage } from "../core/packageLoader.js";
import { parseModelfileOrSystemPrompt } from "../core/modelfilePrompt.js";

const modelOnlyPackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/5g4data-intent-generating-agent-model-only";

test("parseModelfileOrSystemPrompt extracts SYSTEM and MESSAGE few-shots", () => {
  const parsed = parseModelfileOrSystemPrompt(`
SYSTEM """Emit Turtle."""
PARAMETER temperature 0.1
MESSAGE user """hello"""
MESSAGE assistant """@prefix xsd: <http://www.w3.org/2001/XMLSchema#> ."""
`);
  assert.equal(parsed.isModelfile, true);
  assert.equal(parsed.systemPrompt, "Emit Turtle.");
  assert.equal(parsed.fewShotMessages.length, 2);
  assert.equal(parsed.fewShotMessages[0]?.role, "user");
  assert.equal(parsed.fewShotMessages[1]?.role, "assistant");
  assert.match(parsed.fewShotMessages[1]?.content ?? "", /@prefix xsd:/);
});

test("model-only package loads SYSTEM rules and Bodø NE mbit/s few-shot", () => {
  const domainPackage = loadDomainPackage(modelOnlyPackageDir);
  assert.equal(domainPackage.manifest.name, "5g4data-intent-generating-agent-model-only");
  assert.match(domainPackage.systemPromptText, /mbit\/s and ms only/);
  assert.match(domainPackage.systemPromptText, /never as fps/);
  assert.match(domainPackage.systemPromptText, /CATALOGUE \/ GROUNDING DISCIPLINE/);
  assert.match(domainPackage.systemPromptText, /icm:target data5g:deployment/);
  assert.ok(!domainPackage.systemPromptText.includes("MESSAGE user"));
  assert.ok(!domainPackage.systemPromptText.includes("BEGIN AGENT LLM"));
  const fewShots = domainPackage.defaultFewShotMessages ?? [];
  assert.equal(fewShots.length, 10);
  const bodoUser = fewShots.find((m) => m.content.includes("good network for 4K realtime video"));
  assert.ok(bodoUser);
  const bodoIdx = fewShots.indexOf(bodoUser!);
  const bodoAssistant = fewShots[bodoIdx + 1];
  assert.equal(bodoAssistant?.role, "assistant");
  assert.match(bodoAssistant?.content ?? "", /50"\^\^xsd:decimal/);
  assert.match(bodoAssistant?.content ?? "", /quan:unit "mbit\/s"/);
  assert.match(bodoAssistant?.content ?? "", /quan:unit "ms"/);
  assert.doesNotMatch(bodoAssistant?.content ?? "", /quan:unit "fps"/);

  const reUser = fewShots.find((m) => m.content.includes("Observation report storage for this intent: prometheus"));
  assert.ok(reUser);
  const reIdx = fewShots.indexOf(reUser!);
  const reAssistant = fewShots[reIdx + 1];
  assert.equal(reAssistant?.role, "assistant");
  assert.match(reAssistant?.content ?? "", /icm:target data5g:deployment/);
  assert.match(reAssistant?.content ?? "", /rdfs:member data5g:prometheus/);
  assert.match(reAssistant?.content ?? "", /a rdfs:Container/);
  assert.match(reAssistant?.content ?? "", /time:delay \( data5g:lastReportInstant/);
  assert.match(reAssistant?.content ?? "", /imo:eventFor data5g:DEa1b2c3d4e5f60718293a4b5c6d7e8f90/);
  assert.doesNotMatch(reAssistant?.content ?? "", /SustainabilityExpectation/);
  assert.doesNotMatch(reAssistant?.content ?? "", /time:delayDuration/);
  assert.match(
    reAssistant?.content ?? "",
    /REb0c1d2e3f405162738495a6b7c8d9e0f a icm:ObservationReportingExpectation[\s\S]*icm:reportTriggers/
  );
  assert.doesNotMatch(
    reAssistant?.content ?? "",
    /REb0c1d2e3f405162738495a6b7c8d9e0f a icm:ObservationReportingExpectation[\s\S]*log:allOf/
  );
});
