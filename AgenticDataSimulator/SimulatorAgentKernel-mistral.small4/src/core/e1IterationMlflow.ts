import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProjectRoot } from "../config.js";

type E1IterationMlflowConfig = {
  experimentNameTemplate?: string;
  defaultExperimentName?: string;
  overrides?: Record<string, string>;
  description?: string;
  trackingUriHost?: string;
};

let cachedConfig: E1IterationMlflowConfig | null = null;

function loadConfig(): E1IterationMlflowConfig {
  if (cachedConfig) return cachedConfig;
  const path = join(resolveProjectRoot(), "scripts", "e1-iteration-mlflow.json");
  if (!existsSync(path)) {
    cachedConfig = {};
    return cachedConfig;
  }
  cachedConfig = JSON.parse(readFileSync(path, "utf8")) as E1IterationMlflowConfig;
  return cachedConfig;
}

export function resolveE1IterationMlflowExperimentName(iterationLabel?: string): string | undefined {
  const label = iterationLabel?.trim();
  if (!label) return undefined;
  const config = loadConfig();
  const override = config.overrides?.[label]?.trim();
  if (override) return override;
  const template =
    config.experimentNameTemplate?.trim() || "5g4data-intent-mistral-small4-generating-agent-{iteration}";
  return template.replaceAll("{iteration}", label);
}

export function resolveE1IterationMlflowDescription(): string | undefined {
  const description = loadConfig().description?.trim();
  return description || undefined;
}

export function resolveE1IterationMlflowTrackingUriHost(): string | undefined {
  const uri = loadConfig().trackingUriHost?.trim();
  return uri || undefined;
}
