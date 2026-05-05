import { GraphDbTool } from "./graphdbTool.js";
import {
  applyObservationOverride,
  observationStreamStatus,
  startObservationStreams,
  stopObservationStreams
} from "./observationStreamCoordinator.js";

interface ReplObserveHookContext {
  line: string;
  session: { sessionId: string };
  debug: boolean;
  debugLogPath: string;
  packageDir: string;
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
}

function parseKeyValueTokens(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of line.split(/\s+/)) {
    const idx = token.indexOf("=");
    if (idx <= 0) continue;
    const key = token.slice(0, idx).trim();
    const value = token.slice(idx + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function numberOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function handleReplLine(
  ctx: ReplObserveHookContext
): Promise<{ handled: boolean; assistantText?: string }> {
  const line = ctx.line.trim();
  if (!line.toLowerCase().startsWith("observe")) return { handled: false };

  const parts = line.split(/\s+/);
  const action = (parts[1] ?? "").toLowerCase();
  if (!action) {
    return {
      handled: true,
      assistantText:
        "Usage: `observe start intent_id=...`, `observe status`, `observe stop`, `observe override metric=... min=... max=...`."
    };
  }

  if (action === "status") {
    return { handled: true, assistantText: observationStreamStatus(ctx.session.sessionId) };
  }

  if (action === "stop") {
    return { handled: true, assistantText: stopObservationStreams(ctx.session.sessionId) };
  }

  if (action === "override") {
    const kv = parseKeyValueTokens(line);
    const metric = kv.metric;
    if (!metric) {
      return { handled: true, assistantText: "Missing `metric=...` for observe override." };
    }
    const min = numberOrUndefined(kv.min);
    const max = numberOrUndefined(kv.max);
    return {
      handled: true,
      assistantText: applyObservationOverride(ctx.session.sessionId, metric, min, max)
    };
  }

  if (action === "start") {
    const kv = parseKeyValueTokens(line);
    const intentId = kv.intent_id ?? kv.intentId;
    if (!intentId) {
      return { handled: true, assistantText: "Missing `intent_id=...` for observe start." };
    }
    const graphTool = new GraphDbTool(ctx.graphDbEndpoint, ctx.graphDbNamedGraph, ctx.graphDbQueryLimit);
    const intentTurtle = await graphTool.getIntentTurtle(intentId);
    if (!intentTurtle) {
      return {
        handled: true,
        assistantText: `Intent ${intentId} could not be resolved from GraphDB.`
      };
    }
    const assistantText = await startObservationStreams({
      sessionId: ctx.session.sessionId,
      intentId,
      intentTurtle,
      packageDir: ctx.packageDir,
      graphCfg: {
        graphDbEndpoint: ctx.graphDbEndpoint,
        graphDbNamedGraph: ctx.graphDbNamedGraph,
        graphDbQueryLimit: ctx.graphDbQueryLimit
      },
      debug: ctx.debug,
      debugLogPath: ctx.debugLogPath
    });
    return { handled: true, assistantText };
  }

  return {
    handled: true,
    assistantText:
      "Unknown observe action. Use `observe start`, `observe status`, `observe stop`, or `observe override`."
  };
}
