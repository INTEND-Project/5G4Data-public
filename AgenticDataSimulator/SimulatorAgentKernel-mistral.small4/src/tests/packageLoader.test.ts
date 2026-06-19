import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadDomainPackage } from "../core/packageLoader.js";
import { WorkflowEngine } from "../core/workflowEngine.js";

const basePackageDir =
  "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages/5g4data-intent-generation";

test("loads 5g4data-intent-generation package", () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  assert.equal(domainPackage.manifest.name, "5g4data-intent-generation");
  assert.ok(domainPackage.workflow.stages.length > 0);
  assert.ok((domainPackage.promptModules.base ?? "").length > 0);
  assert.ok(domainPackage.postprocessors.length > 0);
  assert.equal(domainPackage.manifest.runtimePatches?.writeIntentTurtleDebugFile, true);
  assert.ok(domainPackage.agentCardPartial?.skills?.length);
  assert.ok(domainPackage.controlApiExtension?.paths);
  assert.ok(domainPackage.intentBindingMetadata?.intentIriField);
});

test("workflow modules resolve based on intent flags", () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const workflow = new WorkflowEngine(domainPackage);
  const modules = workflow.modulesForTurn(
    { deployment: true, locality: true, networkQos: false },
    "default"
  );
  assert.ok(modules.includes("base"));
  assert.ok(modules.includes("deployment"));
  assert.ok(modules.includes("locality"));
});

test("networkQos flag matches network keyword in classification rules", () => {
  const domainPackage = loadDomainPackage(basePackageDir);
  const workflow = new WorkflowEngine(domainPackage);
  const flags = workflow.classifyIntent("good network connection for 4K video");
  assert.equal(flags.networkQos, true);
});

test("domain package swap works by changing directory", () => {
  const templatePackageDir = join(
    "/home/telco/arneme/INTEND-Project/5G4Data-public/AgenticDataSimulator/SimulatorAgentPackages",
    "package-template"
  );
  const domainPackage = loadDomainPackage(templatePackageDir);
  assert.equal(domainPackage.manifest.name, "package-template");
});
