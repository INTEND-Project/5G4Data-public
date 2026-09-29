/** Condition-scoped compound metric: `<stem>_CO<32-hex>`. */
export const CONDITION_COMPOUND_METRIC_RE = /^(.*)_((?:CO[A-Fa-f0-9]{32}))$/iu;

function stripMetricToken(compound: string): string {
  return compound.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
}

/** Hyphen/underscore-insensitive stem comparison (same norm as generating-agent catalogue stems). */
function normalizeStemKey(stem: string): string {
  return stem.replace(/_/g, "-").toLowerCase();
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
 * Map a user-provided metric token to the name stored in GraphDB intent Turtle.
 * 1. Exact compound match
 * 2. Shared condition id (`CO` + 32 hex) when the user token is compound-shaped
 * 3. Bare targetProperty stem → unique matching intent compound (hyphen/underscore-insensitive)
 */
export function resolveCompoundMetricAgainstIntent(
  compoundFromUser: string,
  intentCompoundMetrics: Iterable<string>
): string | null {
  const trimmed = stripMetricToken(compoundFromUser);
  const known = [...intentCompoundMetrics].map(stripMetricToken);
  if (known.includes(trimmed)) return trimmed;

  const parsed = trimmed.match(CONDITION_COMPOUND_METRIC_RE);
  if (parsed?.[2]) {
    const conditionId = parsed[2];
    const byCondition = known.filter((m) => {
      const match = m.match(CONDITION_COMPOUND_METRIC_RE);
      return match?.[2] === conditionId;
    });
    return byCondition.length === 1 ? byCondition[0]! : null;
  }

  // Bare stem: no CO+hex suffix — resolve to unique intent compound with matching stem.
  const stemKey = normalizeStemKey(trimmed);
  if (!stemKey) return null;
  const byStem = known.filter((m) => {
    const match = m.match(CONDITION_COMPOUND_METRIC_RE);
    const stem = match?.[1];
    return stem != null && normalizeStemKey(stem) === stemKey;
  });
  return byStem.length === 1 ? byStem[0]! : null;
}
