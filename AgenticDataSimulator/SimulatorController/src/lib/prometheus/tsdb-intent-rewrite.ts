import { spawn } from "node:child_process";
import path from "node:path";

const CANONICAL_INTENT_ID = /^I[0-9a-f]{32}$/;

/** Large historic TSDB dumps can exceed 10 minutes; allow up to one hour before SIGTERM. */
const TSDB_REWRITE_TIMEOUT_MS = 3_600_000;

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

  await new Promise<void>((resolve, reject) => {
    const child = spawn(scriptPath, [intentId], {
      cwd: stackDir,
      env: {
        ...process.env,
        PROMETHEUS_COMPOSE_DIR: process.env.PROMETHEUS_COMPOSE_DIR?.trim() || stackDir,
        PROMETHEUS_TSDB_DIR:
          process.env.PROMETHEUS_TSDB_DIR?.trim() || path.join(stackDir, "tsdb"),
        PROMETHEUS_IMAGE: process.env.PROMETHEUS_IMAGE?.trim() || "prom/prometheus:v3.12.0",
        PROMETHEUS_CONTAINER: process.env.PROMETHEUS_CONTAINER?.trim() || "5g4data-prometheus",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const killGraceMs = 30_000;
    let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
      sigkillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, killGraceMs);
    }, TSDB_REWRITE_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeoutTimer);
      if (sigkillTimer) {
        clearTimeout(sigkillTimer);
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      if (sigkillTimer) {
        clearTimeout(sigkillTimer);
      }

      if (code === 0) {
        resolve();
        return;
      }

      const tail = (stderr || stdout).trim().slice(-2000);
      reject(
        new Error(
          `Prometheus TSDB rewrite failed (code=${code ?? "null"}, signal=${signal ?? "null"})` +
            (tail ? `: ${tail}` : ""),
        ),
      );
    });
  });
}
