import test from "node:test";
import assert from "node:assert/strict";
import { buildOtlpTracesUrl } from "../tracing/mlflowCompositeProvider.js";
import {
  buildJudgeTraceInputs,
  buildJudgeTraceOutputs,
  buildLlmSpanAttributes,
  buildLlmSpanInputs,
  buildLlmTraceTags,
  mergeTraceTagRecords,
  MLFLOW_LLM_MODEL_ATTR,
  MLFLOW_LLM_PROVIDER_ATTR,
  normalizeStringRecord,
  previewText,
  readTurnTraceJudgeFields,
  resetMlflowTracingStateForTests,
  summarizeMessagesForTrace
} from "../tracing/mlflowTracing.js";
import {
  experimentExistsById,
  resolveMlflowExperimentId
} from "../tracing/experimentResolver.js";

const sampleLlmCall = {
  stage: "main_turn",
  provider: "openai" as const,
  model: "gpt-5.3-chat-latest",
  temperature: 1,
  temperatureSent: true,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  latencyMs: 120,
  requestId: "req-1",
  usageKnown: true
};

test("buildLlmSpanAttributes includes MLflow cost-tracking keys", () => {
  const attrs = buildLlmSpanAttributes(sampleLlmCall);
  assert.equal(attrs[MLFLOW_LLM_MODEL_ATTR], "gpt-5.3-chat-latest");
  assert.equal(attrs[MLFLOW_LLM_PROVIDER_ATTR], "openai");
  assert.equal(attrs["llm.model"], "gpt-5.3-chat-latest");
  assert.equal(attrs["llm.temperature"], 1);
  assert.equal(attrs["llm.temperature_sent"], true);
});

test("buildLlmTraceTags exposes resolved model and temperature for trace filters", () => {
  assert.deepEqual(buildLlmTraceTags(sampleLlmCall), {
    "llm.model": "gpt-5.3-chat-latest",
    "llm.provider": "openai",
    "llm.temperature": "1",
    "llm.temperature_sent": "true"
  });
});

test("buildLlmSpanInputs records resolved call settings and overrides", () => {
  const inputs = buildLlmSpanInputs(
    { ...sampleLlmCall, model: "gpt-4o-mini", temperature: 0, temperatureSent: false },
    { stage: "main_turn", llmModel: "gpt-4o-mini", temperature: 0 },
    [{ role: "user", content: "hello" }]
  );
  assert.equal(inputs.model, "gpt-4o-mini");
  assert.equal(inputs.temperature, 0);
  assert.equal(inputs.temperatureSent, false);
  assert.equal(inputs.modelOverride, "gpt-4o-mini");
  assert.equal(inputs.temperatureOverride, 0);
});

test("buildOtlpTracesUrl uses server root v1 traces path", () => {
  assert.equal(
    buildOtlpTracesUrl("http://mlflow:5000/mlflow"),
    "http://mlflow:5000/v1/traces"
  );
  assert.equal(
    buildOtlpTracesUrl("http://mlflow:5000/mlflow/"),
    "http://mlflow:5000/v1/traces"
  );
  assert.equal(
    buildOtlpTracesUrl("http://localhost:5000"),
    "http://localhost:5000/v1/traces"
  );
});

test("normalizeStringRecord stringifies non-string metadata for MLflow", () => {
  const normalized = normalizeStringRecord({
    "turn.id": "abc",
    count: 3,
    ok: true,
    nested: { a: 1 }
  });
  assert.equal(normalized["turn.id"], "abc");
  assert.equal(normalized.count, "3");
  assert.equal(normalized.ok, "true");
  assert.equal(normalized.nested, '{"a":1}');
});

test("previewText truncates long values within MLflow varchar limit", () => {
  const value = "a".repeat(1200);
  const preview = previewText(value, 1000);
  assert.equal(preview.length, 1000);
  assert.match(preview, /…$/);
});

test("normalizeStringRecord truncates long metadata values for MLflow", () => {
  const normalized = normalizeStringRecord({
    "runtime_context_preview": "x".repeat(1500)
  });
  assert.equal(normalized["runtime_context_preview"]?.length, 1000);
});

test("readTurnTraceJudgeFields extracts judge fields from turn results", () => {
  assert.deepEqual(
    readTurnTraceJudgeFields({
      response: "turtle",
      effectiveUserText: "deploy near Tromso",
      turtlePresent: true,
      confirmationAck: true
    }),
    {
      effectiveUserText: "deploy near Tromso",
      turtlePresent: true,
      confirmationAck: true
    }
  );
  assert.deepEqual(readTurnTraceJudgeFields({ response: "review" }), {});
});

test("buildJudgeTraceInputs uses effectiveUserText on confirmation turns", () => {
  assert.equal(
    buildJudgeTraceInputs({
      userText: "ok",
      effectiveUserText: "deploy llm near Tromso with prometheus storage"
    }),
    "deploy llm near Tromso with prometheus storage"
  );
  assert.equal(
    buildJudgeTraceInputs({ userText: "create an intent for edge llm" }),
    "create an intent for edge llm"
  );
});

test("buildJudgeTraceOutputs exports canonical judge contract fields", () => {
  assert.deepEqual(
    buildJudgeTraceOutputs({
      requirementText: "deploy llm near Tromso",
      generatedResponse: "@prefix icm: ...",
      turtlePresent: true,
      confirmationAck: true,
      warnings: ["note"]
    }),
    {
      requirementText: "deploy llm near Tromso",
      generatedResponse: "@prefix icm: ...",
      turtlePresent: true,
      confirmationAck: true,
      warnings: ["note"]
    }
  );
});

test("buildJudgeTraceOutputs includes SHACL and GraphDB fields from trace tags", () => {
  assert.deepEqual(
    buildJudgeTraceOutputs({
      requirementText: "deploy llm near Tromso",
      generatedResponse: "@prefix icm: ...",
      turtlePresent: true,
      confirmationAck: false,
      warnings: ["SHACL validation failed on attempt 1/3 (2 violation(s)): example"],
      traceTags: {
        "shacl.conforms": "false",
        "shacl.violation_count": "2",
        "shacl.report": "1. example violation",
        "graphdb.persisted": "true",
        "graphdb.intent_id": "Iabc"
      }
    }),
    {
      requirementText: "deploy llm near Tromso",
      generatedResponse: "@prefix icm: ...",
      turtlePresent: true,
      confirmationAck: false,
      warnings: ["SHACL validation failed on attempt 1/3 (2 violation(s)): example"],
      shaclConforms: "false",
      shaclViolationCount: "2",
      shaclReport: "1. example violation",
      graphdbPersisted: "true",
      graphdbIntentId: "Iabc"
    }
  );
});

test("mergeTraceTagRecords preserves later tags without dropping earlier keys", () => {
  const merged = mergeTraceTagRecords(
    { "agent.name": "intent-agent", "intent.flags.deployment": true },
    { "intent.turtle_present": true, "intent.flags.deployment": false }
  );
  assert.equal(merged["agent.name"], "intent-agent");
  assert.equal(merged["intent.flags.deployment"], "false");
  assert.equal(merged["intent.turtle_present"], "true");
});

test("summarizeMessagesForTrace keeps user messages and truncates system prompts", () => {
  const messages = summarizeMessagesForTrace([
    { role: "system", content: "x".repeat(3000) },
    { role: "user", content: "generate an intent" }
  ]);
  assert.equal(messages[1]?.content, "generate an intent");
  assert.equal(messages[0]?.content.length, 2000);
});

test("resolveMlflowExperimentId returns explicit experiment id when it exists", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (String(url).includes("/experiments/get?")) {
      return new Response(
        JSON.stringify({ experiment: { experiment_id: "42", lifecycle_stage: "active" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const id = await resolveMlflowExperimentId({
      trackingUri: "http://localhost:5000/mlflow",
      experimentId: "42"
    });
    assert.equal(id, "42");
    assert.equal(await experimentExistsById("http://localhost:5000/mlflow", "42"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveMlflowExperimentId prefers experiment name over stale id", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (String(url).includes("/experiments/get-by-name")) {
      return new Response(
        JSON.stringify({
          experiment: {
            experiment_id: "77",
            name: "5g4data-intent-generating-agent",
            lifecycle_stage: "active"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const id = await resolveMlflowExperimentId({
      trackingUri: "http://localhost:5000/mlflow",
      experimentId: "4",
      experimentName: "5g4data-intent-generating-agent"
    });
    assert.equal(id, "77");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveMlflowExperimentId creates experiment when name is missing", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET") });
    if (String(url).includes("/experiments/get-by-name")) {
      return new Response("{}", { status: 404 });
    }
    if (String(url).endsWith("/experiments/create")) {
      return new Response(JSON.stringify({ experiment_id: "99" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const id = await resolveMlflowExperimentId({
      trackingUri: "https://start5g-1.cs.uit.no/mlflow",
      experimentName: "5g4data-intent-generating-agent"
    });
    assert.equal(id, "99");
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? "", /experiments\/get-by-name/);
    assert.match(calls[1]?.url ?? "", /experiments\/create$/);
  } finally {
    globalThis.fetch = originalFetch;
    resetMlflowTracingStateForTests();
  }
});

test("resolveMlflowExperimentId restores soft-deleted experiment by name", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET") });
    if (String(url).includes("/experiments/get-by-name")) {
      return new Response(
        JSON.stringify({
          experiment: {
            experiment_id: "4",
            name: "5g4data-intent-generating-agent",
            lifecycle_stage: "deleted"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (String(url).endsWith("/experiments/restore")) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const id = await resolveMlflowExperimentId({
      trackingUri: "http://localhost:5000/mlflow",
      experimentName: "5g4data-intent-generating-agent"
    });
    assert.equal(id, "4");
    assert.equal(calls.length, 2);
    assert.match(calls[1]?.url ?? "", /experiments\/restore$/);
  } finally {
    globalThis.fetch = originalFetch;
    resetMlflowTracingStateForTests();
  }
});
