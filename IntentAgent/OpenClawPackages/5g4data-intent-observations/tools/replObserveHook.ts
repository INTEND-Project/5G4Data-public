import { GraphDbTool } from "./graphdbTool.js";
import {
  effectiveGraphDbEnv,
  type GraphTargetBinding
} from "./graphTargetBinding.js";
import {
  applyObservationOverride,
  observationStreamStatus,
  startObservationStreams,
  stopObservationStreams
} from "./observationStreamCoordinator.js";
import { looksLikeSyntheticObservationPrompt } from "./syntheticPrompt.js";
import {
  handleSyntheticObservationUserLine,
  stopSyntheticObservationForSession,
  syntheticObservationStatus
} from "./syntheticRunOrchestrator.js";

interface ReplObserveHookContext {
  line: string;
  session: { sessionId: string };
  debug: boolean;
  debugLogPath: string;
  packageDir: string;
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
  graphTargetBinding?: GraphTargetBinding | null;
}

function graphFallback(ctx: ReplObserveHookContext) {
  return {
    graphDbEndpoint: ctx.graphDbEndpoint,
    graphDbNamedGraph: ctx.graphDbNamedGraph,
    graphDbQueryLimit: ctx.graphDbQueryLimit
  };
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

  if (!line.toLowerCase().startsWith("observe")) {
    if (looksLikeSyntheticObservationPrompt(line)) {
      const synth = await handleSyntheticObservationUserLine({
        line,
        sessionId: ctx.session.sessionId,
        packageDir: ctx.packageDir,
        graphDbEndpoint: ctx.graphDbEndpoint,
        graphDbNamedGraph: ctx.graphDbNamedGraph,
        graphDbQueryLimit: ctx.graphDbQueryLimit,
        graphTargetBinding: ctx.graphTargetBinding
      });
      if (synth.started && synth.assistantText !== undefined) {
        return { handled: true, assistantText: synth.assistantText };
      }
      if (synth.started) {
        return { handled: true, assistantText: "Synthetic observation flow failed silently." };
      }
    }
    return { handled: false };
  }

  const parts = line.split(/\s+/).map((x) => x.trim());
  const observeToken = parts[0] ?? "";

  const block = observeToken.toLowerCase() === "observe" ? parts.slice(1) : [];

  const action = block[0]?.toLowerCase() ?? "";
  if (!action) {
    return {
      handled: true,
      assistantText:
        "Usage:\n`observe start intent_id=...`\n`observe synthetic ...` (`intent_id=`, `mode=streaming|historic`, `frequency=60s`, `metric=prop_CO...`).\n`observe synthetic stop` | `observe status` | `observe stop` (stops streams + synthetic) | `observe override metric=… min=… max=…`."
    };
  }

  if (action === "synthetic") {
    const sub = (block[1] ?? "").toLowerCase();
    if (sub === "stop") {
      return {
        handled: true,
        assistantText: stopSyntheticObservationForSession(ctx.session.sessionId)
      };
    }
    let payloadLine = "";
    if (sub === "start") {
      payloadLine = block.slice(2).join(" ").trim();
    } else {
      payloadLine = block.slice(1).join(" ").trim();
    }
    const synth = await handleSyntheticObservationUserLine({
      line: payloadLine,
      sessionId: ctx.session.sessionId,
      packageDir: ctx.packageDir,
      graphDbEndpoint: ctx.graphDbEndpoint,
      graphDbNamedGraph: ctx.graphDbNamedGraph,
      graphDbQueryLimit: ctx.graphDbQueryLimit,
      graphTargetBinding: ctx.graphTargetBinding,
      force: true
    });
    if (synth.assistantText !== undefined) {
      return { handled: true, assistantText: synth.assistantText };
    }
    return { handled: true, assistantText: "Synthetic codegen did not yield a reply." };
  }

  if (action === "status") {
    const synthetic = syntheticObservationStatus(ctx.session.sessionId);
    const streams = observationStreamStatus(ctx.session.sessionId);
    return { handled: true, assistantText: `${streams}\n\n${synthetic}` };
  }

  if (action === "stop") {
    const synth = stopSyntheticObservationForSession(ctx.session.sessionId);
    const stream = stopObservationStreams(ctx.session.sessionId);
    return {
      handled: true,
      assistantText: [stream, "", synth].join("\n").trimEnd()
    };
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
    const fallback = graphFallback(ctx);
    const graphTool = GraphDbTool.fromBinding(ctx.graphTargetBinding, fallback);
    const graphEnv = effectiveGraphDbEnv(ctx.graphTargetBinding, fallback);
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
      graphCfg: graphEnv,
      debug: ctx.debug,
      debugLogPath: ctx.debugLogPath
    });
    return { handled: true, assistantText };
  }

  return {
    handled: true,
    assistantText:
      "Unknown observe action. Supported: observe start/synthetic/status/stop/override (+ auto-detected synthetic prompts when not prefixed with observe)."
  };
}
