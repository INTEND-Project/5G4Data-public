import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IntentUsageSummary } from "../models.js";

export function appendUsageLog(
  path: string,
  payload: {
    timestampUtc: string;
    sessionId: string;
    turnId: string;
    usage: IntentUsageSummary;
  }
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify({
    schemaVersion: "llm_usage_v1",
    timestampUtc: payload.timestampUtc,
    sessionId: payload.sessionId,
    turnId: payload.turnId,
    usage: payload.usage
  });
  appendFileSync(path, `${line}\n`, { encoding: "utf8" });
}
