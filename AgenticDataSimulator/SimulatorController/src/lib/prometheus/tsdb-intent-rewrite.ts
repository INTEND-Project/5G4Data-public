import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CANONICAL_INTENT_ID = /^I[0-9a-f]{32}$/;

function defaultRewriteScriptPath(): string {
  const fromEnv = process.env.PROMETHEUS_CLEAR_INTENT_TSDB_SCRIPT?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  return path.resolve(process.cwd(), "..", "Prometheus", "scripts", "clear-intent-from-tsdb.sh");
}

function prometheusStackDir(): string {
  const fromEnv = process.env.PROMETHEUS_STACK_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  return path.resolve(process.cwd(), "..", "Prometheus");
}

export function isTsdbIntentRewriteEnabled(): boolean {
  return process.env.PROMETHEUS_DISABLE_TSDB_REWRITE !== "1";
}

export async function runIntentTsdbRewrite(intentId: string): Promise<void> {
  if (!CANONICAL_INTENT_ID.test(intentId)) {
    throw new Error("intentId must be canonical I + 32 hex characters");
  }

  if (!isTsdbIntentRewriteEnabled()) {
    throw new Error(
      "Prometheus still has samples for this intent after delete_series; set PROMETHEUS_DISABLE_TSDB_REWRITE=0 or run Prometheus/scripts/clear-intent-from-tsdb.sh manually",
    );
  }

  const scriptPath = defaultRewriteScriptPath();
  const stackDir = prometheusStackDir();

  await execFileAsync(scriptPath, [intentId], {
    env: {
      ...process.env,
      PROMETHEUS_COMPOSE_DIR: process.env.PROMETHEUS_COMPOSE_DIR?.trim() || stackDir,
      PROMETHEUS_TSDB_DIR:
        process.env.PROMETHEUS_TSDB_DIR?.trim() || path.join(stackDir, "tsdb"),
      PROMETHEUS_IMAGE: process.env.PROMETHEUS_IMAGE?.trim() || "prom/prometheus:v2.54.1",
      PROMETHEUS_CONTAINER: process.env.PROMETHEUS_CONTAINER?.trim() || "5g4data-prometheus",
    },
    timeout: 600_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}
