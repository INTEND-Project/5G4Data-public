import type { GraphDbTool } from "./graphdbTool.js";
import {
  buildIntentReportTurtle,
  type IntentHandlingStateIri,
} from "./intentReportTurtle.js";
import {
  extractConditionConstraintsById,
  extractConditionMetricsFromIntentTurtle,
  type ConditionConstraint,
  type ConditionMetric,
} from "./intentMetricExtraction.js";
import type { SampleBus } from "./sampleBus.js";
import type { SyntheticMode } from "./syntheticPrompt.js";

export type ComplianceVerdict = "ok" | "fail" | "insufficient_data";

export interface ComplianceResult {
  verdict: ComplianceVerdict;
  /** Human-readable metric names that failed in the retention window (empty unless fail). */
  violatedMetrics: string[];
}

/** Plan default: 1m before first StateCompliant when status is on. */
export const DEFAULT_STATUS_BOOTSTRAP_DELAY_SECONDS = 60;

export function valueSatisfiesConstraint(value: number, constraint: ConditionConstraint): boolean {
  if (!Number.isFinite(value)) return false;
  const q = constraint.quantifier ?? "";
  if (q.endsWith("inRange")) {
    const min = constraint.rangeMin;
    const max = constraint.rangeMax;
    if (min === undefined || max === undefined) return true;
    return value >= min && value <= max;
  }
  const t = constraint.threshold;
  if (t === undefined) return true;
  if (q.endsWith("larger") || q.endsWith("greater")) return value > t;
  if (q.endsWith("smaller")) return value < t;
  if (q.endsWith("atLeast")) return value >= t;
  return true;
}

export function samplesSatisfyConstraint(
  samples: Array<{ value: number }>,
  constraint: ConditionConstraint,
): boolean {
  if (samples.length === 0) return false;
  return samples.every((s) => valueSatisfiesConstraint(s.value, constraint));
}

export interface ConditionComplianceInput {
  conditionId: string;
  metrics: ConditionMetric[];
  constraint: ConditionConstraint;
}

function metricLabel(metric: ConditionMetric): string {
  const stem = metric.targetProperty?.trim();
  if (stem) return stem;
  return metric.compoundMetric;
}

export function formatDegradedReason(violatedMetrics: string[]): string {
  const unique = [...new Set(violatedMetrics.map((m) => m.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return "One or more conditions violated in the retention window.";
  }
  return `Conditions violated for: ${unique.join(", ")}.`;
}

export function evaluateIntentCompliance(
  bus: SampleBus,
  conditions: ConditionComplianceInput[],
  endMs: number,
  retentionSeconds: number,
): ComplianceResult {
  const windowMs = Math.max(1, retentionSeconds) * 1000;
  if (conditions.length === 0) return { verdict: "ok", violatedMetrics: [] };

  const violated = new Set<string>();
  let allConditionsSampled = true;

  for (const row of conditions) {
    const constraint = row.constraint;
    for (const metric of row.metrics) {
      const samples = bus.getSamplesInWindow(metric.compoundMetric, endMs, windowMs);
      if (samples.length === 0) {
        allConditionsSampled = false;
        continue;
      }
      if (!samplesSatisfyConstraint(samples, constraint)) {
        violated.add(metricLabel(metric));
      }
    }
  }

  if (!allConditionsSampled) return { verdict: "insufficient_data", violatedMetrics: [] };
  if (violated.size > 0) {
    return { verdict: "fail", violatedMetrics: [...violated].sort() };
  }
  return { verdict: "ok", violatedMetrics: [] };
}

function groupMetricsByCondition(metrics: ConditionMetric[]): Map<string, ConditionMetric[]> {
  const out = new Map<string, ConditionMetric[]>();
  for (const m of metrics) {
    const list = out.get(m.conditionId) ?? [];
    list.push(m);
    out.set(m.conditionId, list);
  }
  return out;
}

function buildConditionRows(intentTurtle: string): ConditionComplianceInput[] {
  const metrics = extractConditionMetricsFromIntentTurtle(intentTurtle);
  const constraints = extractConditionConstraintsById(intentTurtle);
  const byCondition = groupMetricsByCondition(metrics);
  const rows: ConditionComplianceInput[] = [];
  for (const [conditionId, list] of byCondition) {
    rows.push({
      conditionId,
      metrics: list,
      constraint: constraints.get(conditionId) ?? {},
    });
  }
  return rows;
}

type HandlingPhase = "received" | "compliant" | "degraded";

export interface IntentStatusEvaluatorOptions {
  graph: GraphDbTool;
  intentId: string;
  intentTurtle: string;
  sampleBus: SampleBus;
  mode: SyntheticMode;
  frequencySeconds: number;
  retentionSeconds: number;
  bootstrapCompliantDelaySeconds?: number;
  historicStartMs?: number;
  isRunActive: () => boolean;
}

export class IntentStatusEvaluator {
  private readonly opts: IntentStatusEvaluatorOptions;
  private readonly conditions: ConditionComplianceInput[];
  private reportNumber = 0;
  private phase: HandlingPhase | null = null;
  private evalTimer: NodeJS.Timeout | null = null;
  private bootstrapTimer: NodeJS.Timeout | null = null;
  private simNowMs = Date.now();
  private stopped = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: IntentStatusEvaluatorOptions) {
    this.opts = opts;
    this.conditions = buildConditionRows(opts.intentTurtle);
    if (opts.mode === "historic" && opts.historicStartMs !== undefined) {
      this.simNowMs = opts.historicStartMs;
    }
  }

  /** Condition rows loaded from intent Turtle (for tests / diagnostics). */
  getConditionCount(): number {
    return this.conditions.length;
  }

  async start(): Promise<void> {
    await this.emitReport(
      "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateIntentReceived",
      new Date(this.wallOrSimDate()),
    );
    this.phase = "received";

    // Historic: compliance is applied in finalizeHistoric after the SampleBus is full.
    if (this.opts.mode === "historic") {
      return;
    }

    const delaySec =
      this.opts.bootstrapCompliantDelaySeconds ?? DEFAULT_STATUS_BOOTSTRAP_DELAY_SECONDS;
    if (delaySec > 0) {
      this.bootstrapTimer = setTimeout(() => {
        void this.bootstrapFromEvaluation();
      }, delaySec * 1000);
    } else {
      await this.bootstrapFromEvaluation();
    }

    const freqMs = Math.max(1, this.opts.frequencySeconds) * 1000;
    this.evalTimer = setInterval(() => {
      this.simNowMs = Date.now();
      void this.evaluateAndMaybeReport();
    }, freqMs);
  }

  /**
   * Historic only: ingest timestamps into sim-time while workers stream samples.
   * Evaluation is deferred to {@link finalizeHistoric} so we do not race worker exit.
   */
  noteSampleTimestamp(timestampMs: number): void {
    if (this.opts.mode !== "historic") return;
    if (!Number.isFinite(timestampMs)) return;
    this.simNowMs = Math.max(this.simNowMs, timestampMs);
  }

  /**
   * After all historic workers exit and stdout is drained, walk sim-time and emit
   * Received → Compliant|Degraded transitions from the SampleBus window.
   */
  async finalizeHistoric(endMs: number): Promise<void> {
    if (this.opts.mode !== "historic" || this.stopped) return;

    const startMs = this.opts.historicStartMs ?? endMs;
    const freqMs = Math.max(1, this.opts.frequencySeconds) * 1000;
    const delaySec =
      this.opts.bootstrapCompliantDelaySeconds ?? DEFAULT_STATUS_BOOTSTRAP_DELAY_SECONDS;
    const bootstrapAtMs = startMs + Math.max(0, delaySec) * 1000;
    const stopMs = Math.max(startMs, endMs);

    process.stderr.write(
      `[intent-status] finalizeHistoric intent=${this.opts.intentId} ` +
        `conditions=${this.conditions.length} start=${new Date(startMs).toISOString()} ` +
        `stop=${new Date(stopMs).toISOString()} bootstrapDelay=${delaySec}s\n`,
    );

    for (let t = startMs; t <= stopMs; t += freqMs) {
      if (this.stopped || !this.opts.isRunActive()) break;
      this.simNowMs = t;
      if (this.phase === "received" && t >= bootstrapAtMs) {
        await this.bootstrapFromEvaluation();
      }
      if (this.phase === "compliant" || this.phase === "degraded") {
        await this.evaluateAndMaybeReport();
      }
    }

    if (!this.stopped && this.opts.isRunActive() && this.simNowMs < stopMs) {
      this.simNowMs = stopMs;
      if (this.phase === "received" && stopMs >= bootstrapAtMs) {
        await this.bootstrapFromEvaluation();
      }
      if (this.phase === "compliant" || this.phase === "degraded") {
        await this.evaluateAndMaybeReport();
      }
    }

    process.stderr.write(
      `[intent-status] finalizeHistoric done intent=${this.opts.intentId} ` +
        `phase=${this.phase} reports=${this.reportNumber}\n`,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.evalTimer) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }
    if (this.bootstrapTimer) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = null;
    }
  }

  private wallOrSimDate(): Date {
    return new Date(this.opts.mode === "historic" ? this.simNowMs : Date.now());
  }

  /**
   * First post-Received report: Compliant only if Conditions hold; otherwise Degraded.
   * Leaves phase=received when the retention window still has insufficient_data.
   */
  private async bootstrapFromEvaluation(): Promise<void> {
    if (this.stopped || !this.opts.isRunActive()) return;
    if (this.phase !== "received") return;
    const endMs = this.opts.mode === "historic" ? this.simNowMs : Date.now();
    const { verdict, violatedMetrics } = evaluateIntentCompliance(
      this.opts.sampleBus,
      this.conditions,
      endMs,
      this.opts.retentionSeconds,
    );
    if (verdict === "insufficient_data") return;
    if (verdict === "ok") {
      await this.emitReport(
        "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateCompliant",
        this.wallOrSimDate(),
      );
      this.phase = "compliant";
      return;
    }
    await this.emitReport(
      "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateDegraded",
      this.wallOrSimDate(),
      formatDegradedReason(violatedMetrics),
    );
    this.phase = "degraded";
  }

  private async evaluateAndMaybeReport(): Promise<void> {
    if (this.stopped) return;
    const endMs = this.opts.mode === "historic" ? this.simNowMs : Date.now();
    const { verdict, violatedMetrics } = evaluateIntentCompliance(
      this.opts.sampleBus,
      this.conditions,
      endMs,
      this.opts.retentionSeconds,
    );
    if (verdict === "insufficient_data") return;

    if (verdict === "ok") {
      if (this.phase === "degraded") {
        await this.emitReport(
          "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateCompliant",
          this.wallOrSimDate(),
        );
        this.phase = "compliant";
      }
      return;
    }

    if (this.phase === "compliant" || this.phase === "received") {
      await this.emitReport(
        "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateDegraded",
        this.wallOrSimDate(),
        formatDegradedReason(violatedMetrics),
      );
      this.phase = "degraded";
    }
  }

  private async emitReport(
    handlingState: IntentHandlingStateIri,
    generatedAt: Date,
    reason?: string,
  ): Promise<void> {
    const job = this.writeChain.then(async () => {
      this.reportNumber += 1;
      const turtle = buildIntentReportTurtle({
        intentId: this.opts.intentId,
        handlingState,
        reportNumber: this.reportNumber,
        generatedAt,
        reason,
      });
      const ok = await this.opts.graph.insertTurtle(turtle);
      if (!ok) {
        process.stderr.write(
          `[intent-status] GraphDB insert failed intent=${this.opts.intentId} state=${handlingState}\n`,
        );
      } else {
        process.stderr.write(
          `[intent-status] wrote ${handlingState.split("/").pop()} ` +
            `#${this.reportNumber} at ${generatedAt.toISOString()}\n`,
        );
      }
    });
    this.writeChain = job.catch(() => undefined);
    await job;
  }
}
