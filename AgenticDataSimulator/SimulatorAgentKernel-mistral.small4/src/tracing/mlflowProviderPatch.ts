import { createRequire } from "node:module";
import {
  flushCompositeTraces,
  initializeCompositeSDK
} from "./mlflowCompositeProvider.js";

const require = createRequire(import.meta.url);

type MlflowProviderModule = {
  initializeSDK: () => void;
  flushTraces: () => Promise<void>;
};

const provider = require("mlflow-tracing/dist/core/provider.js") as MlflowProviderModule;

let trackingStoreExportEnabled = true;

export function setTrackingStoreExportEnabled(enabled: boolean): void {
  trackingStoreExportEnabled = enabled;
}

export function isTrackingStoreExportEnabled(): boolean {
  return trackingStoreExportEnabled;
}

/** Replace mlflow-tracing's single-processor SDK with artifact + optional OTLP dual-export. */
export function installMlflowProviderPatch(): void {
  provider.initializeSDK = () => {
    initializeCompositeSDK({ trackingStoreExportEnabled });
  };
  provider.flushTraces = async () => {
    await flushCompositeTraces();
  };
}

installMlflowProviderPatch();
