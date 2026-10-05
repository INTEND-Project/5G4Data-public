import assert from "node:assert/strict";
import test from "node:test";
import {
  IntentStatusEvaluator,
  evaluateIntentCompliance,
  formatDegradedReason,
  valueSatisfiesConstraint,
} from "./intentStatusEvaluator.js";
import { SampleBus } from "./sampleBus.js";
import { resolveSyntheticStatusSettings } from "./syntheticRunOrchestrator.js";
import { parseSyntheticPrompt } from "./syntheticPrompt.js";

test("valueSatisfiesConstraint covers quantifier families", () => {
  assert.equal(valueSatisfiesConstraint(5, { quantifier: "quan:atLeast", threshold: 5 }), true);
  assert.equal(valueSatisfiesConstraint(4.9, { quantifier: "quan:atLeast", threshold: 5 }), false);
  assert.equal(valueSatisfiesConstraint(3, { quantifier: "quan:smaller", threshold: 5 }), true);
  assert.equal(valueSatisfiesConstraint(10, { quantifier: "quan:larger", threshold: 5 }), true);
  assert.equal(
    valueSatisfiesConstraint(7, { quantifier: "quan:inRange", rangeMin: 5, rangeMax: 10 }),
    true,
  );
});

test("evaluateIntentCompliance waits for samples before failing", () => {
  const bus = new SampleBus();
  const conditions = [
    {
      conditionId: "CO1",
      metrics: [{ conditionId: "CO1", targetProperty: "p", compoundMetric: "p_CO1", unit: "x" }],
      constraint: { quantifier: "quan:atLeast", threshold: 10 },
    },
  ];
  assert.equal(evaluateIntentCompliance(bus, conditions, 60_000, 60).verdict, "insufficient_data");
  bus.publish({ metric: "p_CO1", timestampMs: 50_000, value: 5 });
  assert.deepEqual(evaluateIntentCompliance(bus, conditions, 60_000, 60), {
    verdict: "fail",
    violatedMetrics: ["p"],
  });
  bus.publish({ metric: "p_CO1", timestampMs: 59_000, value: 12 });
  assert.equal(evaluateIntentCompliance(bus, conditions, 60_000, 60).verdict, "fail");
  bus.clear();
  bus.publish({ metric: "p_CO1", timestampMs: 59_000, value: 12 });
  assert.deepEqual(evaluateIntentCompliance(bus, conditions, 60_000, 60), {
    verdict: "ok",
    violatedMetrics: [],
  });
});

test("formatDegradedReason lists violated metrics", () => {
  assert.equal(
    formatDegradedReason(["energy-consumption", "power-consumption"]),
    "Conditions violated for: energy-consumption, power-consumption.",
  );
  assert.equal(
    formatDegradedReason([]),
    "One or more conditions violated in the retention window.",
  );
});

test("parseSyntheticPrompt reads status_reports and retention globals", () => {
  const line =
    "`intent_id=Ibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`, `mode=streaming`, `frequency=60s`, " +
    "`status_reports=on`, `retention=5m`, `bootstrap_compliant_delay=30s`. `metric=lat_CO1` ok";
  const parsed = parseSyntheticPrompt(line);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.statusReportsEnabled, true);
  assert.equal(parsed.value.retentionSeconds, 300);
  assert.equal(parsed.value.bootstrapCompliantDelaySeconds, 30);
});

test("resolveSyntheticStatusSettings prefers DSL over session defaults", () => {
  const parsed = parseSyntheticPrompt(
    "`intent_id=Iccccccccccccccccccccccccccccccc`, `mode=streaming`, `frequency=10s`, `status_reports=off`. `metric=a_CO1` x",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const resolved = resolveSyntheticStatusSettings(parsed.value, {
    intentStatusReportsEnabled: true,
    observationRetentionWindow: 120,
  });
  assert.equal(resolved.statusReportsEnabled, false);
  assert.equal(resolved.retentionSeconds, 120);
});

test("resolveSyntheticStatusSettings defaults bootstrap to 60s when status on", () => {
  const parsed = parseSyntheticPrompt(
    "`intent_id=Idddddddddddddddddddddddddddddddd`, `mode=historic`, `start=21.05.2026 05:00:00`, `stop=21.05.2026 06:00:00`, `frequency=60s`, `status_reports=on`. `metric=a_CO1` x",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const resolved = resolveSyntheticStatusSettings(parsed.value, null);
  assert.equal(resolved.statusReportsEnabled, true);
  assert.equal(resolved.bootstrapCompliantDelaySeconds, 60);
});

test("bootstrapFromEvaluation emits Degraded when samples already fail", async () => {
  const bus = new SampleBus();
  bus.publish({ metric: "energy_CO1", timestampMs: 60_000, value: 200 });
  const reports: string[] = [];
  const reasons: string[] = [];
  const graph = {
    insertTurtle: async (turtle: string) => {
      const m = /imo:(State\w+)/.exec(turtle);
      if (m) reports.push(m[1]!);
      const r = /icm:reason "([^"]*)"/.exec(turtle);
      if (r) reasons.push(r[1]!);
      return true;
    },
  };
  const evaluator = new IntentStatusEvaluator({
    graph: graph as never,
    intentId: "Ieeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    intentTurtle: "@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .",
    sampleBus: bus,
    mode: "historic",
    frequencySeconds: 60,
    retentionSeconds: 300,
    bootstrapCompliantDelaySeconds: 60,
    historicStartMs: 0,
    isRunActive: () => true,
  });
  (
    evaluator as unknown as {
      conditions: Array<{
        conditionId: string;
        metrics: Array<{
          conditionId: string;
          targetProperty: string;
          compoundMetric: string;
          unit: string;
        }>;
        constraint: { quantifier: string; threshold: number };
      }>;
    }
  ).conditions = [
    {
      conditionId: "CO1",
      metrics: [
        {
          conditionId: "CO1",
          targetProperty: "energy",
          compoundMetric: "energy_CO1",
          unit: "MJ",
        },
      ],
      constraint: { quantifier: "quan:smaller", threshold: 120 },
    },
  ];

  await evaluator.start();
  await evaluator.finalizeHistoric(120_000);
  assert.deepEqual(reports, ["StateIntentReceived", "StateDegraded"]);
  assert.deepEqual(reasons, ["Conditions violated for: energy."]);
  evaluator.stop();
});
