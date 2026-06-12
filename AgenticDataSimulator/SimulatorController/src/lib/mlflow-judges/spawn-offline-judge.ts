import { spawn } from "node:child_process";
import { join } from "node:path";

const judgesRoot = join(process.cwd(), "..", "mlflow", "judges");

export function spawnOfflineIntentJudge(input: {
  intentId: string;
  repositoryId: string;
  graphIri: string;
  traceId?: string | null;
  turnId?: string | null;
  graphDbBaseUrl?: string | null;
}): void {
  if (!input.intentId || !input.repositoryId || !input.graphIri) return;

  const args = [
    join(judgesRoot, "run-offline-judges.mjs"),
    "intent",
    "--intent-id",
    input.intentId,
    "--repository-id",
    input.repositoryId,
    "--graph-iri",
    input.graphIri,
  ];
  if (input.traceId) {
    args.push("--trace-id", input.traceId);
  }
  if (input.graphDbBaseUrl) {
    args.push("--graphdb-base-url", input.graphDbBaseUrl);
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    cwd: judgesRoot,
    env: process.env,
  });
  child.unref();
}

export function spawnOfflineObservationJudge(input: {
  intentId: string;
  traceId?: string | null;
  prometheusBaseUrl?: string | null;
  progressDir?: string | null;
}): void {
  if (!input.intentId) return;

  const args = [
    join(judgesRoot, "run-offline-judges.mjs"),
    "observation",
    "--intent-id",
    input.intentId,
  ];
  if (input.traceId) args.push("--trace-id", input.traceId);
  if (input.prometheusBaseUrl) args.push("--prometheus-base-url", input.prometheusBaseUrl);
  if (input.progressDir) args.push("--progress-dir", input.progressDir);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    cwd: judgesRoot,
    env: process.env,
  });
  child.unref();
}
