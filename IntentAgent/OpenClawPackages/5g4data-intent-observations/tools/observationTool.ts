import { randomUUID } from "node:crypto";
import { DataFactory, Parser, Store, type Term } from "n3";

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

/** One scheduled stream: one ObservationReportingExpectation × one Condition metric. */
export interface ReportableObservationStream {
  reportingExpectationId: string;
  targetLocalName: string;
  conditionId: string;
  targetProperty: string;
  unit: string;
  frequencySeconds: number;
  minValue: number;
  maxValue: number;
}

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = DataFactory.namedNode(`${RDF_NS}type`);
const RDF_FIRST = DataFactory.namedNode(`${RDF_NS}first`);
const RDF_REST = DataFactory.namedNode(`${RDF_NS}rest`);
const RDF_NIL = DataFactory.namedNode(`${RDF_NS}nil`);

export class ObservationTool {
  private parseStore(intentTurtle: string): Store {
    return new Store(new Parser().parse(intentTurtle));
  }

  private localName(token: string): string {
    const cleaned = token.trim().replace(/[;,.]+$/, "").replace(/^</, "").replace(/>$/, "");
    if (cleaned.startsWith("_:")) return cleaned;
    const hashIdx = cleaned.lastIndexOf("#");
    const slashIdx = cleaned.lastIndexOf("/");
    const colonIdx = cleaned.lastIndexOf(":");
    const cutIdx = Math.max(hashIdx, slashIdx, colonIdx);
    return cutIdx >= 0 && cutIdx < cleaned.length - 1 ? cleaned.slice(cutIdx + 1) : cleaned;
  }

  private termLocal(term: Term | null | undefined): string {
    if (!term) return "";
    if (term.termType === "Literal") return term.value;
    return this.localName(term.value);
  }

  private objectLocalsByPredicateLocal(store: Store, subject: Term, predicateLocal: string): string[] {
    return store
      .getQuads(subject, null, null, null)
      .filter((q) => this.termLocal(q.predicate) === predicateLocal)
      .map((q) => this.termLocal(q.object))
      .filter((x) => x.length > 0);
  }

  private listMembers(store: Store, head: Term): Term[] {
    const out: Term[] = [];
    const seen = new Set<string>();
    let cursor: Term | null = head;
    while (cursor && cursor.termType !== "DefaultGraph" && cursor.value !== RDF_NIL.value) {
      if (seen.has(cursor.value)) break;
      seen.add(cursor.value);
      const first = store.getQuads(cursor, RDF_FIRST, null, null)[0]?.object;
      if (first) out.push(first);
      const rest = store.getQuads(cursor, RDF_REST, null, null)[0]?.object;
      if (!rest) break;
      cursor = rest;
    }
    return out;
  }

  private subjectsWithTypeLocal(store: Store, local: string): Term[] {
    const subjects = new Set<string>();
    const out: Term[] = [];
    for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
      if (this.termLocal(q.object) !== local) continue;
      if (subjects.has(q.subject.value)) continue;
      subjects.add(q.subject.value);
      out.push(q.subject);
    }
    return out;
  }

  private findUnit(store: Store, node: Term): string {
    const direct = this.objectLocalsByPredicateLocal(store, node, "unit")[0];
    if (direct) return direct;

    for (const q of store.getQuads(node, null, null, null)) {
      const child = q.object;
      if (child.termType !== "BlankNode" && child.termType !== "NamedNode") continue;
      const unit = this.objectLocalsByPredicateLocal(store, child, "unit")[0];
      if (unit) return unit;
    }
    return "NA";
  }

  private collectConditionMetricsFromNode(
    store: Store,
    conditionId: string,
    node: Term
  ): Array<{ targetProperty: string; unit: string }> {
    const targetProps = this.objectLocalsByPredicateLocal(store, node, "valuesOfTargetProperty");
    if (targetProps.length === 0) return [];
    const unit = this.findUnit(store, node);
    return targetProps.map((prop) => ({
      targetProperty: prop.replace(new RegExp(`_${conditionId}$`, "i"), ""),
      unit
    }));
  }

  private extractExpectationGraph(intentTurtle: string): {
    expectationTargets: Map<string, string>;
    expectationConditions: Map<string, string[]>;
    reportTargets: Set<string>;
  } {
    const store = this.parseStore(intentTurtle);
    const expectationTargets = new Map<string, string>();
    const expectationConditions = new Map<string, string[]>();
    const reportTargets = new Set<string>();

    const typeMap = new Map<string, Set<string>>();
    for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
      const s = q.subject.value;
      const set = typeMap.get(s) ?? new Set<string>();
      set.add(this.termLocal(q.object));
      typeMap.set(s, set);
    }

    for (const [subjectValue, types] of typeMap.entries()) {
      if (![...types].some((t) => t.endsWith("Expectation"))) continue;
      const subj = DataFactory.namedNode(subjectValue);
      const expId = this.termLocal(subj);
      const target = this.objectLocalsByPredicateLocal(store, subj, "target")[0];
      const conditionIds = this.objectLocalsByPredicateLocal(store, subj, "allOf").filter((x) =>
        x.startsWith("CO")
      );
      if (target) {
        if (types.has("ObservationReportingExpectation")) reportTargets.add(target);
        else expectationTargets.set(expId, target);
      }
      if (conditionIds.length > 0) {
        expectationConditions.set(expId, [...new Set(conditionIds)]);
      }
    }

    return { expectationTargets, expectationConditions, reportTargets };
  }

  parseConditionMetrics(intentTurtle: string): ConditionMetric[] {
    const store = this.parseStore(intentTurtle);
    const out = new Map<string, ConditionMetric>();

    for (const condition of this.subjectsWithTypeLocal(store, "Condition")) {
      const conditionId = this.termLocal(condition);
      const constraintNodes = store
        .getQuads(condition, null, null, null)
        .filter((q) => this.termLocal(q.predicate) === "forAll")
        .map((q) => q.object);
      const metrics = [
        ...this.collectConditionMetricsFromNode(store, conditionId, condition),
        ...constraintNodes.flatMap((n) => this.collectConditionMetricsFromNode(store, conditionId, n))
      ];
      for (const metric of metrics) {
        out.set(`${conditionId}|${metric.targetProperty}`, {
          conditionId,
          targetProperty: metric.targetProperty,
          unit: metric.unit
        });
      }
    }

    return [...out.values()];
  }

  parseReportableConditionMetrics(intentTurtle: string): ConditionMetric[] {
    const allMetrics = this.parseConditionMetrics(intentTurtle);
    const byCondition = new Map(allMetrics.map((m) => [m.conditionId, m]));
    const { expectationTargets, expectationConditions, reportTargets } =
      this.extractExpectationGraph(intentTurtle);

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

  parseDurationSecondsByLocalName(intentTurtle: string): Map<string, number> {
    const store = this.parseStore(intentTurtle);
    const map = new Map<string, number>();

    for (const duration of this.subjectsWithTypeLocal(store, "DurationDescription")) {
      const name = this.termLocal(duration);
      const numericRaw = this.objectLocalsByPredicateLocal(store, duration, "numericDuration")[0];
      const unitLocal = this.objectLocalsByPredicateLocal(store, duration, "unitType")[0];
      const value = Number(numericRaw ?? "");
      if (!Number.isFinite(value) || value <= 0) continue;
      let sec = value;
      if (unitLocal === "unitSecond") sec = value;
      else if (unitLocal === "unitHour") sec = value * 3600;
      else sec = value * 60;
      map.set(name, sec);
    }

    return map;
  }

  parseEventClassToDurationLocal(intentTurtle: string): Map<string, string> {
    const store = this.parseStore(intentTurtle);
    const map = new Map<string, string>();

    for (const ev of store.getQuads(null, null, null, null).map((q) => q.subject)) {
      const delays = this.objectLocalsByPredicateLocal(store, ev, "delay");
      if (delays.length > 0) {
        const delayTerms = store
          .getQuads(ev, null, null, null)
          .filter((q) => this.termLocal(q.predicate) === "delay")
          .map((q) => q.object);
        for (const delay of delayTerms) {
          const members = this.listMembers(store, delay);
          if (members.length >= 2) {
            map.set(this.termLocal(ev), this.termLocal(members[1]));
            break;
          }
          if (members.length === 1) {
            map.set(this.termLocal(ev), this.termLocal(members[0]));
            break;
          }
        }
      }
    }

    return map;
  }

  parseObservationReportingExpectations(intentTurtle: string): Array<{
    id: string;
    target: string;
    triggerEvents: string[];
  }> {
    const store = this.parseStore(intentTurtle);
    const out: Array<{ id: string; target: string; triggerEvents: string[] }> = [];

    for (const subj of this.subjectsWithTypeLocal(store, "ObservationReportingExpectation")) {
      const id = this.termLocal(subj);
      const target = this.objectLocalsByPredicateLocal(store, subj, "target")[0] ?? "";
      const triggerTerms = store
        .getQuads(subj, null, null, null)
        .filter((q) => this.termLocal(q.predicate) === "reportTriggers")
        .map((q) => q.object);
      const triggerEvents: string[] = [];
      for (const trig of triggerTerms) {
        const members = this.objectLocalsByPredicateLocal(store, trig, "member");
        if (members.length > 0) triggerEvents.push(...members);
        else triggerEvents.push(this.termLocal(trig));
      }
      out.push({ id, target, triggerEvents: [...new Set(triggerEvents)] });
    }

    return out;
  }

  parseReportableObservationStreams(intentTurtle: string): ReportableObservationStream[] {
    const seededMetrics = this.parseReportableConditionMetrics(intentTurtle);
    const { expectationTargets, expectationConditions, reportTargets } =
      this.extractExpectationGraph(intentTurtle);

    const conditionsByTarget = new Map<string, Set<string>>();
    for (const [expId, target] of expectationTargets.entries()) {
      if (!reportTargets.has(target)) continue;
      const set = conditionsByTarget.get(target) ?? new Set<string>();
      for (const cid of expectationConditions.get(expId) ?? []) {
        set.add(cid);
      }
      conditionsByTarget.set(target, set);
    }
    const conditionToTarget = new Map<string, string>();
    for (const [target, cids] of conditionsByTarget.entries()) {
      for (const cid of cids) {
        if (!conditionToTarget.has(cid)) conditionToTarget.set(cid, target);
      }
    }

    const durationByName = this.parseDurationSecondsByLocalName(intentTurtle);
    const eventToDur = this.parseEventClassToDurationLocal(intentTurtle);
    const reporting = this.parseObservationReportingExpectations(intentTurtle);
    const targetToReporting = new Map<string, { id: string; frequencySeconds: number }>();
    for (const re of reporting) {
      let frequencySeconds = 600;
      for (const ev of re.triggerEvents) {
        const durLocal = eventToDur.get(ev);
        if (!durLocal) continue;
        const sec = durationByName.get(durLocal);
        if (sec !== undefined && sec > 0) {
          frequencySeconds = sec;
          break;
        }
      }
      if (!targetToReporting.has(re.target)) {
        targetToReporting.set(re.target, { id: re.id, frequencySeconds });
      }
    }

    return seededMetrics.map((metric) => {
      const target = conditionToTarget.get(metric.conditionId) ?? "unknown-target";
      const rep = targetToReporting.get(target);
      return {
        reportingExpectationId: rep?.id ?? `RE_fallback_${target}`,
        targetLocalName: target,
        conditionId: metric.conditionId,
        targetProperty: metric.targetProperty,
        unit: metric.unit || "NA",
        frequencySeconds: rep?.frequencySeconds ?? 600,
        minValue: 10,
        maxValue: 100
      };
    });
  }

  resolveFrequencySeconds(intentTurtle: string, fallback = 600): number {
    return [...this.parseDurationSecondsByLocalName(intentTurtle).values()][0] ?? fallback;
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

  /** Split `{targetProperty}_{conditionId}` where conditionId matches `CO` + 32 hex (case preserved). */
  static parseMetricCompound(compound: string): { targetProperty: string; conditionId: string } | null {
    const trimmed = compound.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
    const m = trimmed.match(/^(.*)_((?:CO[A-Fa-f0-9]{32}))$/iu);
    if (!m?.[2]) return null;
    return { targetProperty: (m[1] ?? "").replace(/`/g, ""), conditionId: m[2] };
  }

  generateObservationForCompound(
    compoundName: string,
    unit: string,
    value: number,
    whenIsoUtc: string
  ): ObservationPayload | null {
    const trimmed = compoundName.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
    if (!ObservationTool.parseMetricCompound(trimmed)) return null;
    return {
      observationId: `OB${randomUUID().replace(/-/g, "")}`,
      observedMetric: trimmed,
      value,
      unit: unit || "NA",
      obtainedAt: whenIsoUtc
    };
  }

  static lookupUnitForCompound(compoundName: string, intentTurtle: string | null | undefined, proseHint?: string): string {
    const trimmed = compoundName.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
    const parsed = ObservationTool.parseMetricCompound(trimmed);
    if (intentTurtle) {
      const tool = new ObservationTool();
      for (const m of tool.parseConditionMetrics(intentTurtle)) {
        if (`${m.targetProperty}_${m.conditionId}` === trimmed) return m.unit || "NA";
      }
      if (parsed) {
        for (const m of tool.parseConditionMetrics(intentTurtle)) {
          const a = m.conditionId.replace(/^CO/iu, "").toLowerCase();
          const b = parsed.conditionId.replace(/^CO/iu, "").toLowerCase();
          if (a === b && m.targetProperty === parsed.targetProperty) return m.unit || "NA";
        }
      }
    }
    return proseFallbackUnit(proseHint);
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

function proseFallbackUnit(hint?: string): string {
  if (!hint) return "NA";
  const lower = hint.toLowerCase();
  if (/\bmbit\b|mb\/s|\bmegabit\b/u.test(lower)) return "mbit/s";
  if (/\bms\b|milliseconds?\b|\blatency\b/u.test(lower)) return "ms";
  return "NA";
}
