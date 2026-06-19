import test from "node:test";
import assert from "node:assert/strict";
import { adjustModulesForConfirmationAck, WorkflowEngine } from "../core/workflowEngine.js";
import type { LoadedDomainPackage } from "../core/packageLoader.js";

const classificationRules = {
  intentFlags: {
    deployment: ["deploy", "llm"],
    locality: ["near", "edge", "tromso", "norway"],
    networkQos: [
      "network",
      "latency",
      "bandwidth",
      "qos",
      "realtime",
      "real-time",
      "mbit",
      "mbit/s",
      "millisecond",
      "milliseconds",
    ],
    sustainability: ["sustainable", "energy"],
  },
};

const stubPackage = {
  classificationRules,
  workflow: { stages: [] },
} as unknown as LoadedDomainPackage;

test("classifyIntent sets networkQos when prompt mentions network", () => {
  const engine = new WorkflowEngine(stubPackage);
  const flags = engine.classifyIntent(
    "good network connection for sending 4K video in near realtime"
  );
  assert.equal(flags.networkQos, true);
});

test("classifyIntent matches locality keywords with diacritics stripped", () => {
  const engine = new WorkflowEngine(stubPackage);
  const flags = engine.classifyIntent("Deploy near Tromsø/Norway");
  assert.equal(flags.locality, true);
});

test("classifyIntent leaves networkQos false without network qos signals", () => {
  const engine = new WorkflowEngine(stubPackage);
  const flags = engine.classifyIntent("Deploy small llm to edge datacenter");
  assert.equal(flags.networkQos, false);
});

test("adjustModulesForConfirmationAck drops review and adds generation", () => {
  const modules = ["base", "defaults", "reporting-storage", "review", "coordination"];
  const adjusted = adjustModulesForConfirmationAck(modules, true);
  assert.ok(!adjusted.includes("review"));
  assert.ok(adjusted.includes("generation"));
  assert.ok(adjusted.includes("coordination"));
});

test("adjustModulesForConfirmationAck leaves modules unchanged before confirmation", () => {
  const modules = ["base", "review", "deployment"];
  assert.deepEqual(adjustModulesForConfirmationAck(modules, false), modules);
});
