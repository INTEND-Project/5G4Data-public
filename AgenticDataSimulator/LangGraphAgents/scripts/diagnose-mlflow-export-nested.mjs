import "../src/tracing/mlflowProviderPatch.js";
import { flushCompositeTraces } from "../src/tracing/mlflowCompositeProvider.js";
import {
  init,
  updateCurrentTrace,
  withSpan,
  SpanType,
  SpanAttributeKey,
  TokenUsageKey
} from "mlflow-tracing";

const trackingUri = process.env.MLFLOW_TRACKING_URI ?? "http://mlflow:5000/mlflow";
const experimentId = process.env.MLFLOW_EXPERIMENT_ID ?? "4";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const response = await originalFetch(url, options);
  if (String(url).includes("/api/3.0/mlflow/traces") && options?.method === "POST") {
    const bodyText = await response.clone().text();
    console.error("--- MLflow createTrace ---");
    console.error("status:", response.status);
    if (response.status >= 400) {
      console.error("response:", bodyText.slice(0, 3000));
      if (options?.body) console.error("request:", String(options.body).slice(0, 4000));
    }
  }
  if (String(url).includes("mlflow-artifacts") && options?.method === "PUT") {
    console.error("--- artifact PUT ---", response.status, String(url).slice(0, 120));
    if (response.status >= 400) console.error(await response.clone().text());
  }
  return response;
};

function normalizeStringRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

init({ trackingUri, experimentId });

await withSpan(
  async (span) => {
    span.setSpanType(SpanType.AGENT);
    span.setInputs({ userText: "create intent", sessionId: "s1", turnId: "t1" });
    updateCurrentTrace({
      tags: normalizeStringRecord({ "agent.name": "intent", "turn.warning_count": 0 }),
      metadata: normalizeStringRecord({
        "agent.name": "intent",
        "turn.id": "t1",
        "mlflow.trace.session": "s1"
      }),
      clientRequestId: "t1",
      requestPreview: "create intent"
    });

    await withSpan(
      async (llm) => {
        llm.setSpanType(SpanType.LLM);
        llm.setInputs({ stage: "main_turn", messages: [{ role: "user", content: "x".repeat(500) }] });
        llm.setAttribute(SpanAttributeKey.TOKEN_USAGE, {
          [TokenUsageKey.INPUT_TOKENS]: 100,
          [TokenUsageKey.OUTPUT_TOKENS]: 50,
          [TokenUsageKey.TOTAL_TOKENS]: 150
        });
        llm.end({ outputs: { text: "@prefix icm: <x> . icm:Intent a icm:Intent ." } });
      },
      { name: "llm_main_turn", spanType: SpanType.LLM }
    );

    await withSpan(
      async (tool) => {
        tool.setSpanType(SpanType.TOOL);
        tool.setInputs({ conforms: true });
        tool.end({ outputs: { result: { conforms: true, text: "ok" } } });
      },
      { name: "shacl_validate", spanType: SpanType.TOOL }
    );

    updateCurrentTrace({ responsePreview: "@prefix icm: <x> . icm:Intent a icm:Intent ." });
    span.end({ outputs: { response: "@prefix icm: <x> .", warnings: [] } });
  },
  { name: "agent_turn", spanType: SpanType.AGENT }
);

await flushCompositeTraces();
console.log("done");
