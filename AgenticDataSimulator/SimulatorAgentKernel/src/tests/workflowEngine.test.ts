import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowEngine } from "../core/workflowEngine.js";
import type { LoadedDomainPackage } from "../core/packageLoader.js";

const classificationRules = {
  intentFlags: {
    deployment: ["deploy", "llm"],
    locality: ["near", "edge"],
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

test("classifyIntent leaves networkQos false without network qos signals", () => {
  const engine = new WorkflowEngine(stubPackage);
  const flags = engine.classifyIntent("Deploy small llm to edge datacenter");
  assert.equal(flags.networkQos, false);
});
