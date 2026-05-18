"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startObservationStreams = startObservationStreams;
exports.stopObservationStreams = stopObservationStreams;
exports.stopAllObservationStreams = stopAllObservationStreams;
exports.observationStreamStatus = observationStreamStatus;
exports.applyObservationOverride = applyObservationOverride;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const graphdbTool_js_1 = require("./graphdbTool.js");
const observationTool_js_1 = require("./observationTool.js");
const sessions = new Map();
function ensureParentDir(filePath) {
    const parent = (0, node_path_1.dirname)(filePath);
    if (!(0, node_fs_1.existsSync)(parent))
        (0, node_fs_1.mkdirSync)(parent, { recursive: true });
}
function metricName(stream) {
    return `${stream.targetProperty}_${stream.conditionId}`;
}
function randomInRange(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max))
        return 0;
    if (max <= min)
        return min;
    return min + Math.random() * (max - min);
}
function streamAsConditionMetric(stream) {
    return {
        conditionId: stream.conditionId,
        targetProperty: stream.targetProperty,
        unit: stream.unit
    };
}
async function emitTick(sessionId, state, stream, tool, graphTool, args) {
    const now = new Date();
    const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
    const metric = metricName(stream);
    const override = state.overrides.get(metric);
    const min = override?.min ?? stream.minValue;
    const max = override?.max ?? stream.maxValue;
    const value = randomInRange(min, max);
    const payload = tool.generateObservation(streamAsConditionMetric(stream), value, iso);
    const turtle = tool.toTurtle(payload);
    if (process.env.NO_GRAPHDB === "true") {
        process.stdout.write(`${turtle}\n\nGraphDB write skipped (--noGraphDB)\n`);
    }
    else {
        await graphTool.insertTurtle(turtle);
    }
    if (!args.debug)
        return;
    const streamLogPath = (0, node_path_1.resolve)(process.cwd(), "logs", "observations-stream.ndjson");
    ensureParentDir(streamLogPath);
    (0, node_fs_1.appendFileSync)(streamLogPath, `${JSON.stringify({
        timestampUtc: now.toISOString(),
        sessionId,
        intentId: state.intentId,
        metric,
        value,
        frequencySeconds: stream.frequencySeconds
    })}\n`, "utf8");
    const metricLogPath = (0, node_path_1.resolve)(process.cwd(), "logs", "observations-by-metric", `${metric}.ttl`);
    ensureParentDir(metricLogPath);
    (0, node_fs_1.appendFileSync)(metricLogPath, `# emittedAt=${now.toISOString()}\n${turtle}\n---\n`, "utf8");
}
async function startObservationStreams(args) {
    stopObservationStreams(args.sessionId);
    const tool = new observationTool_js_1.ObservationTool();
    const streams = tool.parseReportableObservationStreams(args.intentTurtle);
    if (streams.length === 0) {
        return "No reportable observation streams found (check ObservationReportingExpectation + Conditions + report triggers).";
    }
    const graphTool = new graphdbTool_js_1.GraphDbTool(args.graphCfg.graphDbEndpoint, args.graphCfg.graphDbNamedGraph, args.graphCfg.graphDbQueryLimit);
    const state = {
        intentId: args.intentId,
        streams: [],
        overrides: new Map()
    };
    sessions.set(args.sessionId, state);
    for (const stream of streams) {
        const tick = () => {
            void emitTick(args.sessionId, state, stream, tool, graphTool, args);
        };
        tick();
        const timer = setInterval(tick, Math.max(1, stream.frequencySeconds) * 1000);
        state.streams.push({ stream, timer });
    }
    const logsRoot = (0, node_path_1.resolve)(process.cwd(), "logs");
    return [
        `Started ${state.streams.length} observation stream(s) for intent ${args.intentId}.`,
        `Tick log: ${(0, node_path_1.resolve)(logsRoot, "observations-stream.ndjson")}`,
        `Per-metric Turtle (debug): ${(0, node_path_1.resolve)(logsRoot, "observations-by-metric")}/`,
        "Commands: `observe status`, `observe stop`, `observe override metric=... min=... max=...`."
    ].join("\n");
}
function stopObservationStreams(sessionId) {
    const state = sessions.get(sessionId);
    if (!state)
        return "No active observation streams for this session.";
    for (const rt of state.streams)
        clearInterval(rt.timer);
    sessions.delete(sessionId);
    return `Stopped ${state.streams.length} observation stream(s).`;
}
function stopAllObservationStreams() {
    for (const sessionId of sessions.keys()) {
        stopObservationStreams(sessionId);
    }
}
function observationStreamStatus(sessionId) {
    const state = sessions.get(sessionId);
    if (!state || state.streams.length === 0)
        return "No active observation streams.";
    const lines = state.streams.map(({ stream }) => `- metric=${metricName(stream)}, every=${stream.frequencySeconds}s, min=${stream.minValue}, max=${stream.maxValue}`);
    return [`Active observation streams: ${state.streams.length}`, ...lines].join("\n");
}
function applyObservationOverride(sessionId, metric, min, max) {
    const state = sessions.get(sessionId);
    if (!state)
        return "No active observation streams. Start with `observe start intent_id=...`.";
    const prev = state.overrides.get(metric) ?? {};
    state.overrides.set(metric, { min: min ?? prev.min, max: max ?? prev.max });
    const merged = state.overrides.get(metric) ?? {};
    return `Override stored for ${metric}: min=${merged.min ?? "unchanged"}, max=${merged.max ?? "unchanged"}.`;
}
