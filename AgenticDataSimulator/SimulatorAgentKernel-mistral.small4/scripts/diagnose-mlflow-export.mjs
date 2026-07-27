/**
 * One-shot diagnostic: reproduce MLflow trace export and print 400 response bodies.
 * Usage (inside agent container): node scripts/diagnose-mlflow-export.mjs
 */
import "../src/tracing/mlflowProviderPatch.js";
import { flushCompositeTraces } from "../src/tracing/mlflowCompositeProvider.js";
import {
  init,
  updateCurrentTrace,
  withSpan,
  SpanType
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
    console.error("response:", bodyText.slice(0, 2000));
    if (options?.body) {
      console.error("request:", String(options.body).slice(0, 3000));
    }
  }
  return response;
};

init({ trackingUri, experimentId });

await withSpan(
  async (span) => {
    span.setSpanType(SpanType.AGENT);
    span.setInputs({ userText: "diagnostic ping", sessionId: "s1", turnId: "t1" });
    updateCurrentTrace({
      metadata: {
        "agent.name": "diag",
        "turn.id": "t1",
        "mlflow.trace.session": "s1"
      },
      tags: { "agent.name": "diag" },
      clientRequestId: "t1",
      requestPreview: "diagnostic ping"
    });
    updateCurrentTrace({ responsePreview: "diagnostic reply" });
    span.end({ outputs: { response: "diagnostic reply", warnings: [] } });
  },
  { name: "agent_turn", spanType: SpanType.AGENT }
);

await flushCompositeTraces();
console.log("done");
