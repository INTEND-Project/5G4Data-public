import { randomUUID } from "node:crypto";

export interface ObservationPayload {
  observationId: string;
  observedMetric: string;
  value: number;
  unit: string;
  obtainedAt: string;
}

export interface ConditionMetric {
  conditionId: string;
  targetProperty: string;
  unit: string;
}

export interface OverrideWindow {
  startTime: string;
  endTime: string;
  min?: number;
  max?: number;
  frequencySeconds?: number;
}

export class ObservationTool {
  private localName(token: string): string {
    const cleaned = token.trim().replace(/[;,.]+$/, "");
    if (cleaned.startsWith("data5g:")) return cleaned.replace("data5g:", "");
    const hashIdx = cleaned.lastIndexOf("#");
    const gtIdx = cleaned.lastIndexOf(">");
    const cutIdx = Math.max(hashIdx, gtIdx);
    if (cutIdx >= 0 && cutIdx < cleaned.length - 1) {
      return cleaned.slice(cutIdx + 1).replace(/^</, "");
    }
    return cleaned.replace(/^</, "").replace(/>$/, "");
  }

  parseConditionMetrics(intentTurtle: string): ConditionMetric[] {
    const lines = intentTurtle.split(/\r?\n/);
    const out: ConditionMetric[] = [];
    let currentCondition: string | null = null;
    let currentUnit = "NA";
    for (const raw of lines) {
      const line = raw.trim();
      const conditionMatch =
        /^data5g:([A-Za-z0-9_-]+)\s+a\s+icm:Condition/.exec(line) ||
        /^<[^>]*#([A-Za-z0-9_-]+)>\s+a\s+icm:Condition/.exec(line);
      if (conditionMatch) {
        currentCondition = conditionMatch[1] ?? null;
        currentUnit = "NA";
        continue;
      }
      if (!currentCondition) continue;
      const propertyMatch =
        /icm:valuesOfTargetProperty\s+data5g:([A-Za-z0-9_-]+)/.exec(line) ||
        /icm:valuesOfTargetProperty\s+<([^>]+)>/.exec(line);
      if (propertyMatch) {
        const prop = this.localName(propertyMatch[1] ?? "");
        const normalized = prop.replace(new RegExp(`_${currentCondition}$`, "i"), "");
        out.push({
          conditionId: currentCondition,
          targetProperty: normalized,
          unit: currentUnit
        });
      }
      const unitMatch = /quan:unit\s+"([^"]+)"/.exec(line);
      if (unitMatch) {
        currentUnit = unitMatch[1] ?? "NA";
      }
    }
    return out;
  }

  parseReportableConditionMetrics(intentTurtle: string): ConditionMetric[] {
    const lines = intentTurtle.split(/\r?\n/).map((l) => l.trim());
    const allMetrics = this.parseConditionMetrics(intentTurtle);
    const byCondition = new Map(allMetrics.map((m) => [m.conditionId, m]));
    const expectationTargets = new Map<string, string>(); // expectation -> target
    const expectationConditions = new Map<string, string[]>(); // expectation -> condition ids
    const reportTargets = new Set<string>(); // reported targets

    let currentExpectation: string | null = null;
    let currentReportExpectation = false;

    for (const line of lines) {
      const expMatch =
        /^data5g:([A-Za-z0-9_-]+)\s+a\s+data5g:[A-Za-z0-9_-]*Expectation/.exec(line) ||
        /^<[^>]*#([A-Za-z0-9_-]+)>\s+a\s+data5g:[A-Za-z0-9_-]*Expectation/.exec(line);
      if (expMatch) {
        currentExpectation = expMatch[1] ?? null;
        currentReportExpectation = /icm:ObservationReportingExpectation/.test(line);
      }
      const repMatch =
        /^data5g:([A-Za-z0-9_-]+)\s+a\s+icm:ObservationReportingExpectation/.exec(line) ||
        /^<[^>]*#([A-Za-z0-9_-]+)>\s+a\s+icm:ObservationReportingExpectation/.exec(line);
      if (repMatch) {
        currentExpectation = repMatch[1] ?? null;
        currentReportExpectation = true;
      }

      if (currentExpectation) {
        const targetMatch = /icm:target\s+([^\s;]+)/.exec(line);
        if (targetMatch) {
          const target = this.localName(targetMatch[1] ?? "");
          if (currentReportExpectation) reportTargets.add(target);
          else expectationTargets.set(currentExpectation, target);
        }
        const allOfMatch = /data5g:(CO[A-Za-z0-9_-]+)/g;
        const found: string[] = [];
        let m: RegExpExecArray | null = allOfMatch.exec(line);
        while (m) {
          if (m[1]) found.push(m[1]);
          m = allOfMatch.exec(line);
        }
        if (found.length > 0) {
          const prev = expectationConditions.get(currentExpectation) ?? [];
          expectationConditions.set(currentExpectation, [...prev, ...found]);
        }
      }
    }

    const reportableConditionIds = new Set<string>();
    for (const [expId, target] of expectationTargets.entries()) {
      if (!reportTargets.has(target)) continue;
      for (const conditionId of expectationConditions.get(expId) ?? []) {
        reportableConditionIds.add(conditionId);
      }
    }

    const reportable = [...reportableConditionIds]
      .map((cid) => byCondition.get(cid))
      .filter((m): m is ConditionMetric => Boolean(m));
    return reportable.length > 0 ? reportable : allMetrics;
  }

  resolveFrequencySeconds(intentTurtle: string, fallback = 600): number {
    const numeric = /time:numericDuration\s+"([^"]+)"/.exec(intentTurtle)?.[1];
    const unit = /time:unitType\s+time:(unitSecond|unitMinute|unitHour)/.exec(intentTurtle)?.[1];
    const value = numeric ? Number(numeric) : NaN;
    if (!Number.isFinite(value) || value <= 0) return fallback;
    if (unit === "unitSecond") return value;
    if (unit === "unitHour") return value * 3600;
    return value * 60;
  }

  generateObservation(metric: ConditionMetric, value: number, whenIsoUtc: string): ObservationPayload {
    return {
      observationId: `OB${randomUUID().replace(/-/g, "")}`,
      observedMetric: `${metric.targetProperty}_${metric.conditionId}`,
      value,
      unit: metric.unit || "NA",
      obtainedAt: whenIsoUtc
    };
  }

  toTurtle(payload: ObservationPayload): string {
    return `@prefix met: <http://tio.models.tmforum.org/tio/v3.6.0/MetricsAndObservations/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix data5g: <http://5g4data.eu/5g4data#> .

data5g:${payload.observationId} a met:Observation ;
    met:observedMetric data5g:${payload.observedMetric} ;
    met:observedValue [ rdf:value ${payload.value.toFixed(1)} ; quan:unit "${payload.unit}" ] ;
    met:obtainedAt "${payload.obtainedAt}"^^xsd:dateTime .`;
  }

  metricsSummary(intentTurtle: string): string {
    const metrics = this.parseReportableConditionMetrics(intentTurtle);
    if (metrics.length === 0) {
      return "No reportable Condition metrics extracted from intent Turtle.";
    }
    const lines = metrics.map(
      (m) =>
        `- condition=${m.conditionId}, metric=data5g:${m.targetProperty}_${m.conditionId}, unit=${m.unit || "NA"}`
    );
    return ["Reportable metrics extracted from Condition statements:", ...lines].join("\n");
  }
}
