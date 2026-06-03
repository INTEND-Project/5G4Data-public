import test from "node:test";
import assert from "node:assert/strict";
import {
  bindingsConflict,
  parseGraphTargetBindingFromMetadata,
  parseOpenClawControllerMetadata,
} from "../core/graphTargetBinding.js";

test("parseGraphTargetBindingFromMetadata accepts v1 envelope", () => {
  const binding = parseGraphTargetBindingFromMetadata({
    openclaw: {
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
    openclaw: {
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

test("parseOpenClawControllerMetadata accepts llm-only envelope", () => {
  const parsed = parseOpenClawControllerMetadata({
    openclaw: {
      controllerBindingVersion: "1",
      llmModel: "gpt-4o-mini",
      temperature: 0.4,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.llmModel, "gpt-4o-mini");
  assert.equal(parsed.temperature, 0.4);
  assert.equal(parsed.graphTarget, null);
});

test("parseOpenClawControllerMetadata clamps temperature", () => {
  const parsed = parseOpenClawControllerMetadata({
    openclaw: {
      controllerBindingVersion: "1",
      temperature: 9,
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.temperature, 2);
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
