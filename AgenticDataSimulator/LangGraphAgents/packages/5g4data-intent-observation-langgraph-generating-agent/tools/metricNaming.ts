/** Condition-scoped compound metric: `<stem>_CO<32-hex>`. */
export const CONDITION_COMPOUND_METRIC_RE = /^(.*)_((?:CO[A-Fa-f0-9]{32}))$/iu;

function stripMetricToken(compound: string): string {
  return compound.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
}

/**
 * Resolve the compound metric name from `icm:valuesOfTargetProperty` in intent Turtle
 * loaded from GraphDB. That local name is the observations agent source of truth.
 */
export function resolveConditionScopedMetricName(args: {
  valuesOfTargetPropertyLocal: string;
  conditionId: string;
}): { targetProperty: string; compoundMetric: string } {
  const prop = args.valuesOfTargetPropertyLocal.trim();
  const conditionId = args.conditionId.trim();
  const compoundMatch = prop.match(CONDITION_COMPOUND_METRIC_RE);
  if (compoundMatch?.[1] && compoundMatch[2]) {
    return {
      targetProperty: compoundMatch[1],
      compoundMetric: prop
    };
  }
  const stem = prop.replace(new RegExp(`_${conditionId}$`, "i"), "") || prop;
  return {
    targetProperty: stem,
    compoundMetric: `${stem}_${conditionId}`
  };
}

/**
 * Map a user-provided compound metric to the name stored in GraphDB intent Turtle.
 * Matches exact compound first, then by shared condition id (`CO` + 32 hex).
 */
export function resolveCompoundMetricAgainstIntent(
  compoundFromUser: string,
  intentCompoundMetrics: Iterable<string>
): string | null {
  const trimmed = stripMetricToken(compoundFromUser);
  const known = [...intentCompoundMetrics];
  if (known.includes(trimmed)) return trimmed;

  const parsed = trimmed.match(CONDITION_COMPOUND_METRIC_RE);
  const conditionId = parsed?.[2];
  if (!conditionId) return null;

  const byCondition = known.filter((m) => {
    const match = m.match(CONDITION_COMPOUND_METRIC_RE);
    return match?.[2] === conditionId;
  });
  return byCondition.length === 1 ? byCondition[0]! : null;
}
