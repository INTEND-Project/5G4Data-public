import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AgentTurnResult, ChatSession } from "../models.js";

export interface ApiDebugConfig {
  enabled: boolean;
  debugLogPath: string;
  writeIntentTurtleDebugFile: boolean;
}

export function appendDebugLog(
  enabled: boolean,
  debugLogPath: string,
  session: ChatSession,
  userText: string,
  result: AgentTurnResult
): void {
  if (!enabled) return;
  const absolutePath = resolve(process.cwd(), debugLogPath);
  const parent = dirname(absolutePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  const entry = {
    timestampUtc: new Date().toISOString(),
    sessionId: session.sessionId,
    userText,
    assistantResponse: result.response,
    warnings: result.warnings,
    debugEntries: result.debug,
    usage: result.intentUsageSummary
  };
  appendFileSync(absolutePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function extractIntentTurtle(responseText: string): { intentId: string; turtle: string } | null {
  const trimmed = responseText.trim();
  const fenced = trimmed.match(/^```(?:turtle|ttl)?\s*([\s\S]*?)\s*```$/i);
  const turtle = (fenced?.[1] ?? trimmed).trim();
  if (!turtle.includes("icm:Intent")) return null;
  const idMatch = turtle.match(/\bdata5g:(I[a-f0-9]{32}|I[a-f0-9-]{36})\b/i);
  if (!idMatch?.[1]) return null;
  return { intentId: idMatch[1], turtle };
}

export function writeIntentTurtleDebugFile(debugLogPath: string, responseText: string): void {
  const extracted = extractIntentTurtle(responseText);
  if (!extracted) return;
  const logsDir = dirname(resolve(process.cwd(), debugLogPath));
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  const filePath = join(logsDir, `${extracted.intentId}.ttl`);
  writeFileSync(filePath, `${extracted.turtle}\n`, "utf8");
}

export function recordApiTurnDebug(
  apiDebug: ApiDebugConfig | undefined,
  session: ChatSession,
  userText: string,
  result: AgentTurnResult
): void {
  if (!apiDebug?.enabled) return;
  appendDebugLog(true, apiDebug.debugLogPath, session, userText, result);
  if (apiDebug.writeIntentTurtleDebugFile) {
    writeIntentTurtleDebugFile(apiDebug.debugLogPath, result.response);
  }
}
