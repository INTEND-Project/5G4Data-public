import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MlflowClient } from "mlflow-tracing";
import { getAuthProvider, getConfig } from "mlflow-tracing/dist/core/config.js";
import { MlflowSpanExporter, MlflowSpanProcessor } from "mlflow-tracing/dist/exporters/mlflow.js";

const MLFLOW_EXPERIMENT_ID_HEADER = "x-mlflow-experiment-id";

let sdk: NodeSDK | null = null;
let mlflowProcessor: MlflowSpanProcessor | null = null;
let otlpProcessor: BatchSpanProcessor | null = null;

/** MLflow serves OTLP at server root `/v1/traces`, not under the `/mlflow` API prefix. */
export function buildOtlpTracesUrl(trackingUri: string): string {
  const { origin } = new URL(trackingUri);
  return `${origin}/v1/traces`;
}

export function initializeCompositeSDK(options: { trackingStoreExportEnabled: boolean }): void {
  if (sdk) {
    sdk.shutdown().catch((error) => {
      console.error("[MLflow] SDK shutdown error:", error);
    });
    sdk = null;
    mlflowProcessor = null;
    otlpProcessor = null;
  }

  try {
    const config = getConfig();
    const authProvider = getAuthProvider();
    const client = new MlflowClient({
      trackingUri: config.trackingUri,
      authProvider
    });
    const exporter = new MlflowSpanExporter(client);
    mlflowProcessor = new MlflowSpanProcessor(exporter);

    const processors: SpanProcessor[] = [mlflowProcessor];
    if (options.trackingStoreExportEnabled) {
      const otlpUrl = buildOtlpTracesUrl(config.trackingUri);
      const otlpExporter = new OTLPTraceExporter({
        url: otlpUrl,
        headers: {
          [MLFLOW_EXPERIMENT_ID_HEADER]: config.experimentId
        }
      });
      otlpProcessor = new BatchSpanProcessor(otlpExporter);
      processors.push(otlpProcessor);
    }

    sdk = new NodeSDK({ spanProcessors: processors });
    sdk.start();
  } catch (error) {
    console.error("[MLflow] Failed to initialize composite tracing SDK:", error);
  }
}

export async function flushCompositeTraces(): Promise<void> {
  await otlpProcessor?.forceFlush();
  await mlflowProcessor?.forceFlush();
}

export async function shutdownCompositeSdk(): Promise<void> {
  if (!sdk) return;
  await flushCompositeTraces();
  await sdk.shutdown();
  sdk = null;
  mlflowProcessor = null;
  otlpProcessor = null;
}
