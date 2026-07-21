import { DataFactory, Parser, Store, type Term } from "n3";
import { resolveConditionScopedMetricName } from "./metricNaming.js";

export interface ConditionMetric {
  conditionId: string;
  targetProperty: string;
  compoundMetric: string;
  unit: string;
}

export interface ConditionConstraint {
  threshold?: number;
  quantifier?: string;
}

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDF_TYPE = DataFactory.namedNode(`${RDF_NS}type`);

function parseStore(intentTurtle: string): Store {
  return new Store(new Parser().parse(intentTurtle));
}

function localName(token: string): string {
  const cleaned = token.trim().replace(/[;,.]+$/, "").replace(/^</, "").replace(/>$/, "");
  if (cleaned.startsWith("_:")) return cleaned;
  const hashIdx = cleaned.lastIndexOf("#");
  const slashIdx = cleaned.lastIndexOf("/");
  const colonIdx = cleaned.lastIndexOf(":");
  const cutIdx = Math.max(hashIdx, slashIdx, colonIdx);
  return cutIdx >= 0 && cutIdx < cleaned.length - 1 ? cleaned.slice(cutIdx + 1) : cleaned;
}

function termLocal(term: Term | null | undefined): string {
  if (!term) return "";
  if (term.termType === "Literal") return term.value;
  return localName(term.value);
}

function objectLocalsByPredicateLocal(store: Store, subject: Term, predicateLocal: string): string[] {
  return store
    .getQuads(subject, null, null, null)
    .filter((q) => termLocal(q.predicate) === predicateLocal)
    .map((q) => termLocal(q.object))
    .filter((x) => x.length > 0);
}

function subjectsWithTypeLocal(store: Store, local: string): Term[] {
  const subjects = new Set<string>();
  const out: Term[] = [];
  for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
    if (termLocal(q.object) !== local) continue;
    if (subjects.has(q.subject.value)) continue;
    subjects.add(q.subject.value);
    out.push(q.subject);
  }
  return out;
}

function findUnit(store: Store, node: Term): string {
  const direct = objectLocalsByPredicateLocal(store, node, "unit")[0];
  if (direct) return direct;

  for (const q of store.getQuads(node, null, null, null)) {
    const child = q.object;
    if (child.termType !== "BlankNode" && child.termType !== "NamedNode") continue;
    const unit = objectLocalsByPredicateLocal(store, child, "unit")[0];
    if (unit) return unit;
  }
  return "NA";
}

function nodeHasValuesOfTargetProperty(store: Store, node: Term): boolean {
  return objectLocalsByPredicateLocal(store, node, "valuesOfTargetProperty").length > 0;
}

/** Nodes on a Condition subject that may carry metric constraints. */
export function conditionConstraintNodes(store: Store, condition: Term): Term[] {
  const nodes: Term[] = [condition];
  const seen = new Set<string>([condition.value]);

  for (const q of store.getQuads(condition, null, null, null)) {
    const predLocal = termLocal(q.predicate);
    if (predLocal !== "forAll" && predLocal !== "allOf") continue;
    const child = q.object;
    if (seen.has(child.value)) continue;
    // On expectations, log:allOf points to CO*/CX* refs; on conditions it may be a metric block.
    if (predLocal === "allOf" && child.termType === "NamedNode" && termLocal(child).startsWith("CO")) {
      continue;
    }
    if (predLocal === "allOf" && child.termType === "NamedNode" && termLocal(child).startsWith("CX")) {
      continue;
    }
    seen.add(child.value);
    nodes.push(child);
  }

  return nodes;
}

function collectConditionMetricsFromNode(
  store: Store,
  conditionId: string,
  node: Term,
): Array<{ targetProperty: string; compoundMetric: string; unit: string }> {
  const targetProps = objectLocalsByPredicateLocal(store, node, "valuesOfTargetProperty");
  if (targetProps.length === 0) return [];
  const unit = findUnit(store, node);
  return targetProps.map((prop) => {
    const resolved = resolveConditionScopedMetricName({
      valuesOfTargetPropertyLocal: prop,
      conditionId,
    });
    return {
      targetProperty: resolved.targetProperty,
      compoundMetric: resolved.compoundMetric,
      unit,
    };
  });
}

function parseConditionConstraint(store: Store, ...nodes: Term[]): ConditionConstraint {
  for (const node of nodes) {
    for (const q of store.getQuads(node, null, null, null)) {
      const predLocal = termLocal(q.predicate);
      if (predLocal !== "larger" && predLocal !== "smaller") continue;
      const valueRaw = objectLocalsByPredicateLocal(store, q.object, "value")[0];
      const threshold = Number(valueRaw);
      return {
        quantifier: `quan:${predLocal}`,
        threshold: Number.isFinite(threshold) ? threshold : undefined,
      };
    }
  }
  return {};
}

export function extractConditionMetricsFromIntentTurtle(intentTurtle: string): ConditionMetric[] {
  const store = parseStore(intentTurtle);
  const out = new Map<string, ConditionMetric>();

  for (const condition of subjectsWithTypeLocal(store, "Condition")) {
    const conditionId = termLocal(condition);
    const metrics = conditionConstraintNodes(store, condition).flatMap((node) =>
      collectConditionMetricsFromNode(store, conditionId, node),
    );
    for (const metric of metrics) {
      out.set(`${conditionId}|${metric.compoundMetric}`, {
        conditionId,
        targetProperty: metric.targetProperty,
        compoundMetric: metric.compoundMetric,
        unit: metric.unit,
      });
    }
  }

  return [...out.values()];
}

export function extractCompoundMetricNamesFromIntentTurtle(intentTurtle: string): string[] {
  return extractConditionMetricsFromIntentTurtle(intentTurtle).map((m) => m.compoundMetric);
}

export function extractConditionConstraintsById(intentTurtle: string): Map<string, ConditionConstraint> {
  const store = parseStore(intentTurtle);
  const out = new Map<string, ConditionConstraint>();
  for (const condition of subjectsWithTypeLocal(store, "Condition")) {
    const conditionId = termLocal(condition);
    const constraintNodes = conditionConstraintNodes(store, condition).filter(
      (node) => node.value !== condition.value || nodeHasValuesOfTargetProperty(store, node),
    );
    out.set(conditionId, parseConditionConstraint(store, ...constraintNodes));
  }
  return out;
}
