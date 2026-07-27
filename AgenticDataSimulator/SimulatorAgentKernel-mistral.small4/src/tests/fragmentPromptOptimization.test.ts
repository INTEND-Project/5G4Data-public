import test from "node:test";
import assert from "node:assert/strict";
import {
  compactDraftContextJson,
  isFragmentTokenOptimizationEnabled,
  sliceRuntimeContextForFragment
} from "../core/fragmentPromptOptimization.js";
import type { IntentDraft } from "../models.js";

const SAMPLE_CONTEXT = `Runtime grounding context:

[Ontology]
large ontology block

[Example intents]
large examples block

[Workload catalogue]
- chart-a: desc
- chart-b: desc

[selected workload objectives]
Selected chart: rusty-llm (version 1.0)
Deployment objective defaults from values.yaml objectives:
- p99-token-target

[GraphDB]
EC_31 Tromso datacenter

[Workflow override]
Deployment request detected without explicit locality cue.
`;

test("sliceRuntimeContextForFragment omits ontology and examples for deployment", () => {
  const sliced = sliceRuntimeContextForFragment(SAMPLE_CONTEXT, "deployment");
  assert.doesNotMatch(sliced, /\[Ontology\]/);
  assert.doesNotMatch(sliced, /\[Example intents\]/);
  assert.match(sliced, /\[selected workload objectives\]/);
  assert.match(sliced, /\[GraphDB\]/);
  assert.match(sliced, /\[Workflow override\]/);
});

test("sliceRuntimeContextForFragment keeps only workload for sustainability", () => {
  const sliced = sliceRuntimeContextForFragment(SAMPLE_CONTEXT, "sustainability");
  assert.match(sliced, /\[selected workload objectives\]/);
  assert.doesNotMatch(sliced, /\[GraphDB\]/);
  assert.doesNotMatch(sliced, /\[Ontology\]/);
});

test("compactDraftContextJson is single-line JSON", () => {
  const draft: IntentDraft = {
    intentDescription: "deploy llm",
    fragments: [{ id: "deployment", turtle: "", locals: ["DE__ID_DEPLOYMENT_1__"] }]
  };
  const json = compactDraftContextJson(draft);
  assert.doesNotMatch(json, /\n/);
  assert.match(json, /DE__ID_DEPLOYMENT_1__/);
});

test("isFragmentTokenOptimizationEnabled defaults to true", () => {
  const previous = process.env.FRAGMENT_OPTIMIZE_TOKENS;
  delete process.env.FRAGMENT_OPTIMIZE_TOKENS;
  try {
    assert.equal(isFragmentTokenOptimizationEnabled(), true);
    process.env.FRAGMENT_OPTIMIZE_TOKENS = "false";
    assert.equal(isFragmentTokenOptimizationEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.FRAGMENT_OPTIMIZE_TOKENS;
    else process.env.FRAGMENT_OPTIMIZE_TOKENS = previous;
  }
});
