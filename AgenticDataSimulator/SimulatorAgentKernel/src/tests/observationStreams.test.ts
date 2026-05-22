import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDomainPackage } from "../core/packageLoader.js";
import { ObservationTool } from "../../../SimulatorAgentPackages/5g4data-intent-observations/tools/observationTool.js";
import {
  applyObservationOverride,
  startObservationStreams,
  stopObservationStreams
} from "../../../SimulatorAgentPackages/5g4data-intent-observations/tools/observationStreamCoordinator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "observation-streams-min.ttl");
const observationsPackageDir = join(
  __dirname,
  "../../../SimulatorAgentPackages/5g4data-intent-observations"
);

test("5g4data-intent-observations manifest exposes replPreTurn hook", () => {
  const pkg = loadDomainPackage(observationsPackageDir);
  assert.equal(pkg.manifest.runtimeHooks?.replPreTurn, "tools/replObserveHook.ts");
});

test("parseReportableObservationStreams resolves per-RE frequencies", () => {
  const ttl = readFileSync(fixturePath, "utf8");
  const tool = new ObservationTool();
  const streams = tool.parseReportableObservationStreams(ttl);
  assert.equal(streams.length, 2);
  const byCond = new Map(streams.map((s) => [s.conditionId, s.frequencySeconds]));
  assert.equal(byCond.get("COone"), 1);
  assert.equal(byCond.get("COtwo"), 2);
});

test("applyObservationOverride merges min/max for active session", async () => {
  const prev = process.env.NO_GRAPHDB;
  process.env.NO_GRAPHDB = "true";
  const ttl = readFileSync(fixturePath, "utf8");
  const sessionId = "test_session_override";
  try {
    stopObservationStreams(sessionId);
    const msg = await startObservationStreams({
      sessionId,
      intentId: "Itest",
      intentTurtle: ttl,
      packageDir: observationsPackageDir,
      graphCfg: {
        graphDbEndpoint: "http://localhost:7200/repositories/test",
        graphDbNamedGraph: "http://example.org/g",
        graphDbQueryLimit: 0
      },
      debug: false,
      debugLogPath: "logs/openclaw-agent-debug.jsonl"
    });
    assert.ok(msg.includes("Started"));
    assert.ok(
      applyObservationOverride(sessionId, "metricA_COone", 1, 2).includes("Override stored")
    );
  } finally {
    stopObservationStreams(sessionId);
    if (prev === undefined) delete process.env.NO_GRAPHDB;
    else process.env.NO_GRAPHDB = prev;
  }
});
