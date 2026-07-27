import test from "node:test";
import assert from "node:assert/strict";
import {
  bindingsConflict,
  parseGraphTargetBindingFromMetadata,
  parseSimulatorControllerMetadata,
} from "../core/graphTargetBinding.js";

test("parseGraphTargetBindingFromMetadata accepts v1 envelope", () => {
  const binding = parseGraphTargetBindingFromMetadata({
    simulator: {
      controllerBindingVersion: "1",
      graphTarget: {
        graphTargetId: "cuid-1",
        repositoryId: "repo-a",
        graphIri: "urn:intend:kg:a",
        sparqlEndpoint: "http://gdb/repositories/repo-a/sparql",
        repositoryBaseUrl: "http://gdb/repositories/repo-a",
      },
    },
  });
  assert.ok(binding);
  assert.equal(binding.repositoryId, "repo-a");
  assert.equal(binding.graphIri, "urn:intend:kg:a");
});

test("parseGraphTargetBindingFromMetadata rejects unsupported version", () => {
  const binding = parseGraphTargetBindingFromMetadata({
    simulator: {
      controllerBindingVersion: "99",
      graphTarget: {
        repositoryId: "repo-a",
        graphIri: "urn:g",
        sparqlEndpoint: "http://gdb/sparql",
      },
    },
  });
  assert.equal(binding, null);
});

test("parseSimulatorControllerMetadata accepts llm-only envelope", () => {
  const parsed = parseSimulatorControllerMetadata({
    simulator: {
      controllerBindingVersion: "1",
      llmModel: "codestral:latest",
      llmApiBaseUrl: "http://spark:11434/v1",
      temperature: 0.4,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.llmModel, "codestral:latest");
  assert.equal(parsed.llmApiBaseUrl, "http://spark:11434/v1");
  assert.equal(parsed.temperature, 0.4);
  assert.equal(parsed.graphTarget, null);
});

test("parseSimulatorControllerMetadata clamps temperature", () => {
  const parsed = parseSimulatorControllerMetadata({
    simulator: {
      controllerBindingVersion: "1",
      temperature: 9,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.temperature, 2);
});

test("parseSimulatorControllerMetadata accepts reportingIntervalMinutes", () => {
  const parsed = parseSimulatorControllerMetadata({
    simulator: {
      controllerBindingVersion: "1",
      reportingIntervalMinutes: 15,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.reportingIntervalMinutes, 15);
});

test("parseSimulatorControllerMetadata clamps reportingIntervalMinutes", () => {
  const parsed = parseSimulatorControllerMetadata({
    simulator: {
      controllerBindingVersion: "1",
      reportingIntervalMinutes: 99999,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.reportingIntervalMinutes, 1440);
});

test("parseSimulatorControllerMetadata accepts prometheusBaseUrl", () => {
  const parsed = parseSimulatorControllerMetadata({
    simulator: {
      controllerBindingVersion: "1",
      prometheusBaseUrl: "https://partner.example/prometheus",
      prometheusStorageMode: "external",
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.prometheusBaseUrl, "https://partner.example/prometheus");
  assert.equal(parsed.prometheusStorageMode, "external");
});

test("parseSimulatorControllerMetadata accepts reportingIntervalSeconds", () => {
  const parsed = parseSimulatorControllerMetadata({
    simulator: {
      controllerBindingVersion: "1",
      reportingIntervalSeconds: 60,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.reportingIntervalSeconds, 60);
  assert.equal(parsed.reportingIntervalMinutes, null);
});

test("bindingsConflict detects repository or graph drift", () => {
  const existing = {
    repositoryId: "a",
    graphIri: "urn:g1",
    sparqlEndpoint: "http://gdb/repositories/a/sparql",
  };
  assert.equal(
    bindingsConflict(existing, {
      ...existing,
      graphIri: "urn:g2",
    }),
    true,
  );
  assert.equal(bindingsConflict(existing, { ...existing }), false);
});
