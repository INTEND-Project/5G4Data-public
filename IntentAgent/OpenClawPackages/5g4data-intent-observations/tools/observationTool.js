"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservationTool = void 0;
const node_crypto_1 = require("node:crypto");
const n3_1 = require("n3");
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = n3_1.DataFactory.namedNode(`${RDF_NS}type`);
const RDF_FIRST = n3_1.DataFactory.namedNode(`${RDF_NS}first`);
const RDF_REST = n3_1.DataFactory.namedNode(`${RDF_NS}rest`);
const RDF_NIL = n3_1.DataFactory.namedNode(`${RDF_NS}nil`);
class ObservationTool {
    parseStore(intentTurtle) {
        return new n3_1.Store(new n3_1.Parser().parse(intentTurtle));
    }
    localName(token) {
        const cleaned = token.trim().replace(/[;,.]+$/, "").replace(/^</, "").replace(/>$/, "");
        if (cleaned.startsWith("_:"))
            return cleaned;
        const hashIdx = cleaned.lastIndexOf("#");
        const slashIdx = cleaned.lastIndexOf("/");
        const colonIdx = cleaned.lastIndexOf(":");
        const cutIdx = Math.max(hashIdx, slashIdx, colonIdx);
        return cutIdx >= 0 && cutIdx < cleaned.length - 1 ? cleaned.slice(cutIdx + 1) : cleaned;
    }
    termLocal(term) {
        if (!term)
            return "";
        if (term.termType === "Literal")
            return term.value;
        return this.localName(term.value);
    }
    objectLocalsByPredicateLocal(store, subject, predicateLocal) {
        return store
            .getQuads(subject, null, null, null)
            .filter((q) => this.termLocal(q.predicate) === predicateLocal)
            .map((q) => this.termLocal(q.object))
            .filter((x) => x.length > 0);
    }
    listMembers(store, head) {
        const out = [];
        const seen = new Set();
        let cursor = head;
        while (cursor && cursor.termType !== "DefaultGraph" && cursor.value !== RDF_NIL.value) {
            if (seen.has(cursor.value))
                break;
            seen.add(cursor.value);
            const first = store.getQuads(cursor, RDF_FIRST, null, null)[0]?.object;
            if (first)
                out.push(first);
            const rest = store.getQuads(cursor, RDF_REST, null, null)[0]?.object;
            if (!rest)
                break;
            cursor = rest;
        }
        return out;
    }
    subjectsWithTypeLocal(store, local) {
        const subjects = new Set();
        const out = [];
        for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
            if (this.termLocal(q.object) !== local)
                continue;
            if (subjects.has(q.subject.value))
                continue;
            subjects.add(q.subject.value);
            out.push(q.subject);
        }
        return out;
    }
    findUnit(store, node) {
        const direct = this.objectLocalsByPredicateLocal(store, node, "unit")[0];
        if (direct)
            return direct;
        for (const q of store.getQuads(node, null, null, null)) {
            const child = q.object;
            if (child.termType !== "BlankNode" && child.termType !== "NamedNode")
                continue;
            const unit = this.objectLocalsByPredicateLocal(store, child, "unit")[0];
            if (unit)
                return unit;
        }
        return "NA";
    }
    collectConditionMetricsFromNode(store, conditionId, node) {
        const targetProps = this.objectLocalsByPredicateLocal(store, node, "valuesOfTargetProperty");
        if (targetProps.length === 0)
            return [];
        const unit = this.findUnit(store, node);
        return targetProps.map((prop) => ({
            targetProperty: prop.replace(new RegExp(`_${conditionId}$`, "i"), ""),
            unit
        }));
    }
    extractExpectationGraph(intentTurtle) {
        const store = this.parseStore(intentTurtle);
        const expectationTargets = new Map();
        const expectationConditions = new Map();
        const reportTargets = new Set();
        const typeMap = new Map();
        for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
            const s = q.subject.value;
            const set = typeMap.get(s) ?? new Set();
            set.add(this.termLocal(q.object));
            typeMap.set(s, set);
        }
        for (const [subjectValue, types] of typeMap.entries()) {
            if (![...types].some((t) => t.endsWith("Expectation")))
                continue;
            const subj = n3_1.DataFactory.namedNode(subjectValue);
            const expId = this.termLocal(subj);
            const target = this.objectLocalsByPredicateLocal(store, subj, "target")[0];
            const conditionIds = this.objectLocalsByPredicateLocal(store, subj, "allOf").filter((x) => x.startsWith("CO"));
            if (target) {
                if (types.has("ObservationReportingExpectation"))
                    reportTargets.add(target);
                else
                    expectationTargets.set(expId, target);
            }
            if (conditionIds.length > 0) {
                expectationConditions.set(expId, [...new Set(conditionIds)]);
            }
        }
        return { expectationTargets, expectationConditions, reportTargets };
    }
    parseConditionMetrics(intentTurtle) {
        const store = this.parseStore(intentTurtle);
        const out = new Map();
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
    parseReportableConditionMetrics(intentTurtle) {
        const allMetrics = this.parseConditionMetrics(intentTurtle);
        const byCondition = new Map(allMetrics.map((m) => [m.conditionId, m]));
        const { expectationTargets, expectationConditions, reportTargets } = this.extractExpectationGraph(intentTurtle);
        const reportableConditionIds = new Set();
        for (const [expId, target] of expectationTargets.entries()) {
            if (!reportTargets.has(target))
                continue;
            for (const conditionId of expectationConditions.get(expId) ?? []) {
                reportableConditionIds.add(conditionId);
            }
        }
        const reportable = [...reportableConditionIds]
            .map((cid) => byCondition.get(cid))
            .filter((m) => Boolean(m));
        return reportable.length > 0 ? reportable : allMetrics;
    }
    parseDurationSecondsByLocalName(intentTurtle) {
        const store = this.parseStore(intentTurtle);
        const map = new Map();
        for (const duration of this.subjectsWithTypeLocal(store, "DurationDescription")) {
            const name = this.termLocal(duration);
            const numericRaw = this.objectLocalsByPredicateLocal(store, duration, "numericDuration")[0];
            const unitLocal = this.objectLocalsByPredicateLocal(store, duration, "unitType")[0];
            const value = Number(numericRaw ?? "");
            if (!Number.isFinite(value) || value <= 0)
                continue;
            let sec = value;
            if (unitLocal === "unitSecond")
                sec = value;
            else if (unitLocal === "unitHour")
                sec = value * 3600;
            else
                sec = value * 60;
            map.set(name, sec);
        }
        return map;
    }
    parseEventClassToDurationLocal(intentTurtle) {
        const store = this.parseStore(intentTurtle);
        const map = new Map();
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
    parseObservationReportingExpectations(intentTurtle) {
        const store = this.parseStore(intentTurtle);
        const out = [];
        for (const subj of this.subjectsWithTypeLocal(store, "ObservationReportingExpectation")) {
            const id = this.termLocal(subj);
            const target = this.objectLocalsByPredicateLocal(store, subj, "target")[0] ?? "";
            const triggerTerms = store
                .getQuads(subj, null, null, null)
                .filter((q) => this.termLocal(q.predicate) === "reportTriggers")
                .map((q) => q.object);
            const triggerEvents = [];
            for (const trig of triggerTerms) {
                const members = this.objectLocalsByPredicateLocal(store, trig, "member");
                if (members.length > 0)
                    triggerEvents.push(...members);
                else
                    triggerEvents.push(this.termLocal(trig));
            }
            out.push({ id, target, triggerEvents: [...new Set(triggerEvents)] });
        }
        return out;
    }
    parseReportableObservationStreams(intentTurtle) {
        const seededMetrics = this.parseReportableConditionMetrics(intentTurtle);
        const { expectationTargets, expectationConditions, reportTargets } = this.extractExpectationGraph(intentTurtle);
        const conditionsByTarget = new Map();
        for (const [expId, target] of expectationTargets.entries()) {
            if (!reportTargets.has(target))
                continue;
            const set = conditionsByTarget.get(target) ?? new Set();
            for (const cid of expectationConditions.get(expId) ?? []) {
                set.add(cid);
            }
            conditionsByTarget.set(target, set);
        }
        const conditionToTarget = new Map();
        for (const [target, cids] of conditionsByTarget.entries()) {
            for (const cid of cids) {
                if (!conditionToTarget.has(cid))
                    conditionToTarget.set(cid, target);
            }
        }
        const durationByName = this.parseDurationSecondsByLocalName(intentTurtle);
        const eventToDur = this.parseEventClassToDurationLocal(intentTurtle);
        const reporting = this.parseObservationReportingExpectations(intentTurtle);
        const targetToReporting = new Map();
        for (const re of reporting) {
            let frequencySeconds = 600;
            for (const ev of re.triggerEvents) {
                const durLocal = eventToDur.get(ev);
                if (!durLocal)
                    continue;
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
    resolveFrequencySeconds(intentTurtle, fallback = 600) {
        return [...this.parseDurationSecondsByLocalName(intentTurtle).values()][0] ?? fallback;
    }
    generateObservation(metric, value, whenIsoUtc) {
        return {
            observationId: `OB${(0, node_crypto_1.randomUUID)().replace(/-/g, "")}`,
            observedMetric: `${metric.targetProperty}_${metric.conditionId}`,
            value,
            unit: metric.unit || "NA",
            obtainedAt: whenIsoUtc
        };
    }
    toTurtle(payload) {
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
    metricsSummary(intentTurtle) {
        const metrics = this.parseReportableConditionMetrics(intentTurtle);
        if (metrics.length === 0) {
            return "No reportable Condition metrics extracted from intent Turtle.";
        }
        const lines = metrics.map((m) => `- condition=${m.conditionId}, metric=data5g:${m.targetProperty}_${m.conditionId}, unit=${m.unit || "NA"}`);
        return ["Reportable metrics extracted from Condition statements:", ...lines].join("\n");
    }
}
exports.ObservationTool = ObservationTool;
