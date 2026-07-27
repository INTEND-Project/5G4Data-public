/**
 * Export a diagnostic trace with OTLP dual-write and print TRACKING_STORE hints.
 * Usage: MLFLOW_TRACKING_URI=http://mlflow:5000/mlflow MLFLOW_EXPERIMENT_ID=4 \
 *   npx tsx scripts/diagnose-mlflow-tracking-store.mjs
 */
import "../src/tracing/mlflowProviderPatch.js";
import { flushCompositeTraces } from "../src/tracing/mlflowCompositeProvider.js";
import {
  getLastActiveTraceId,
  init,
  updateCurrentTrace,
  withSpan,
  SpanType
} from "mlflow-tracing";

const trackingUri = process.env.MLFLOW_TRACKING_URI ?? "http://127.0.0.1:5000/mlflow";
const experimentId = process.env.MLFLOW_EXPERIMENT_ID ?? "4";

init({ trackingUri, experimentId });

await withSpan(
  async (span) => {
    span.setSpanType(SpanType.AGENT);
    span.setInputs({ userText: "tracking-store diagnostic", sessionId: "s1", turnId: "t-diag" });
    updateCurrentTrace({
      metadata: {
        "agent.name": "diag",
        "turn.id": "t-diag",
        "mlflow.trace.session": "s1"
      },
      tags: { "agent.name": "diag" },
      clientRequestId: "t-diag",
      requestPreview: "tracking-store diagnostic"
    });
    updateCurrentTrace({ responsePreview: "tracking-store diagnostic reply" });
    span.end({ outputs: { response: "tracking-store diagnostic reply", warnings: [] } });
  },
  { name: "agent_turn", spanType: SpanType.AGENT }
);

await flushCompositeTraces();
const traceId = getLastActiveTraceId();
console.log(JSON.stringify({ ok: true, traceId, trackingUri, experimentId }));
console.log(
  "Verify: SELECT key, value FROM trace_tags WHERE request_id =",
  traceId,
  "AND key = 'mlflow.trace.spansLocation';"
);
