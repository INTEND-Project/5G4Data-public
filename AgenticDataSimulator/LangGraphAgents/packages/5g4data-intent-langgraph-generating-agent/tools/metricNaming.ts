/** Condition-scoped compound metric: `<stem>_CO<32-hex>`. */
export const CONDITION_COMPOUND_METRIC_RE = /^(.*)_((?:CO[A-Fa-f0-9]{32}))$/iu;

/** Network metric stems are always lowercase in generated intents (see network.md / SKILL.md). */
export const CANONICAL_NETWORK_METRIC_STEMS = ["bandwidth", "latency"] as const;

/** Parse metric stems from catalogue runtime context (values.yaml objectives/sustainability). */
export function parseMetricStemsFromRuntimeContext(runtimeContext: string): string[] {
  const stems = new Set<string>();
  for (const m of runtimeContext.matchAll(/^- ([^\s:]+): threshold=/gmu)) {
    const stem = m[1]?.trim();
    if (stem) stems.add(stem);
  }
  return [...stems];
}

/** Map hyphen/underscore variants to the canonical stem from values.yaml. */
export function canonicalMetricStem(stem: string, knownStems: Iterable<string>): string {
  const trimmed = stem.trim();
  if (!trimmed) return trimmed;
  const known = [...knownStems];
  if (known.includes(trimmed)) return trimmed;
  const norm = (s: string) => s.replace(/_/g, "-").toLowerCase();
  const target = norm(trimmed);
  const matches = known.filter((k) => norm(k) === target);
  return matches.length === 1 ? matches[0]! : trimmed;
}

export function resolveConditionScopedMetricName(args: {
  valuesOfTargetPropertyLocal: string;
  conditionId: string;
  knownMetricStems?: Iterable<string>;
}): { targetProperty: string; compoundMetric: string } {
  const prop = args.valuesOfTargetPropertyLocal.trim();
  const conditionId = args.conditionId.trim();
  const compoundMatch = prop.match(CONDITION_COMPOUND_METRIC_RE);
  const suffixConditionId = compoundMatch?.[2] ?? conditionId;
  let stemFromProperty = compoundMatch?.[1] ?? (prop.replace(new RegExp(`_${conditionId}$`, "i"), "") || prop);
  if (args.knownMetricStems) {
    stemFromProperty = canonicalMetricStem(stemFromProperty, args.knownMetricStems);
  }
  const compoundMetric = compoundMatch
    ? `${stemFromProperty}_${suffixConditionId}`
    : `${stemFromProperty}_${conditionId}`;
  return { targetProperty: stemFromProperty, compoundMetric };
}

/** Metric stems from condition dct:description lines (e.g. "p99-token-target condition ..."). */
export function parseMetricStemsFromConditionDescriptions(text: string): string[] {
  const stems = new Set<string>();
  for (const m of text.matchAll(/dct:description\s+"([^"\s]+)\s+condition\b/giu)) {
    const stem = m[1]?.trim();
    if (stem) stems.add(stem);
  }
  return [...stems];
}

export function collectKnownMetricStems(args: {
  runtimeContext?: string;
  text?: string;
  explicitStems?: Iterable<string>;
}): string[] {
  const stems = new Set<string>();
  for (const stem of CANONICAL_NETWORK_METRIC_STEMS) {
    stems.add(stem);
  }
  for (const stem of args.explicitStems ?? []) {
    if (stem.trim()) stems.add(stem.trim());
  }
  for (const stem of parseMetricStemsFromRuntimeContext(args.runtimeContext ?? "")) stems.add(stem);
  for (const stem of parseMetricStemsFromConditionDescriptions(args.text ?? "")) stems.add(stem);
  return [...stems];
}

/** Rewrite `valuesOfTargetProperty` locals to match catalogue stems from values.yaml. */
export function normalizeConditionScopedMetricNamesFromCatalogue(
  text: string,
  runtimeContextOrStems: string | Iterable<string>
): string {
  const knownStems =
    typeof runtimeContextOrStems === "string"
      ? collectKnownMetricStems({ runtimeContext: runtimeContextOrStems, text })
      : collectKnownMetricStems({ explicitStems: runtimeContextOrStems, text });
  if (knownStems.length === 0) return text;
  return text.replace(/valuesOfTargetProperty\s+data5g:([^\s;,]+)/gi, (full, metricLocal) => {
    const local = String(metricLocal);
    const compound = local.match(CONDITION_COMPOUND_METRIC_RE);
    const placeholder = local.match(/^(.*)_((?:CO)?__ID_[A-Z0-9_]+__)$/);
    let stem: string | undefined;
    let suffix: string | undefined;
    if (compound?.[1] && compound[2]) {
      stem = compound[1];
      suffix = compound[2];
    } else if (placeholder?.[1] && placeholder[2]) {
      stem = placeholder[1];
      suffix = placeholder[2];
    } else {
      return full;
    }
    const canonical = canonicalMetricStem(stem, knownStems);
    if (canonical === stem) return full;
    return `valuesOfTargetProperty data5g:${canonical}_${suffix}`;
  });
}
