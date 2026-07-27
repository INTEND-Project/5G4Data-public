const COMPOUND_METRIC_RE = /^(.*)_CO([a-f0-9]{32})$/i;

export function parseCompoundMetricParts(compoundMetric: string): {
  compoundMetric: string;
  conditionId: string | null;
} {
  const match = compoundMetric.trim().match(COMPOUND_METRIC_RE);
  if (!match) {
    return { compoundMetric: compoundMetric.trim(), conditionId: null };
  }

  return {
    compoundMetric: compoundMetric.trim(),
    conditionId: `CO${match[2]}`,
  };
}
