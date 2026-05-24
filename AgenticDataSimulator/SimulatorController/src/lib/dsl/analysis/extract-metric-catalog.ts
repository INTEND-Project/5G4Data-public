const conditionSuffixPattern = /_CO[a-f0-9]+$/i;

/** Condition-scoped compound metric: `<stem>_CO<32-hex>`. */
const COMPOUND_METRIC_RE = /^(.*)_CO[a-f0-9]{32}$/i;

/** Same capture shape as the observation agent synthetic prompt parser. */
const METRIC_TOKEN_RE = /\bmetric\s*=\s*((?:[^\s.`]+|`[^`]*`))(?!=)/gi;

export function extractMetricCatalog(metricPropertyNames: string[]) {
  return Array.from(
    new Set(
      metricPropertyNames.map((metricName) => metricName.replace(conditionSuffixPattern, "")),
    ),
  );
}

export type MetricStemResolution = {
  instructions: string;
  resolved: Array<{ stem: string; compound: string }>;
  ambiguous: string[];
  unmatched: string[];
};

function stripMetricValue(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("`") && value.endsWith("`")) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/^`+|`+$/g, "");
}

/** Index full GraphDB metric names by unique stem. */
export function buildStemToCompoundMap(metricNames: string[]): Map<string, string> {
  const compoundsByStem = new Map<string, string[]>();

  for (const fullName of metricNames) {
    const match = fullName.match(COMPOUND_METRIC_RE);
    if (match?.[1]) {
      const stem = match[1];
      const list = compoundsByStem.get(stem) ?? [];
      list.push(fullName);
      compoundsByStem.set(stem, list);
    }
  }

  const map = new Map<string, string>();
  for (const fullName of metricNames) {
    map.set(fullName, fullName);
  }
  for (const [stem, compounds] of compoundsByStem) {
    if (compounds.length === 1) {
      map.set(stem, compounds[0]!);
    }
  }
  return map;
}

export function resolveMetricStemsInObservationInstructions(
  instructions: string,
  metricCatalog: string[],
): MetricStemResolution {
  if (metricCatalog.length === 0) {
    return { instructions, resolved: [], ambiguous: [], unmatched: [] };
  }

  const stemMap = buildStemToCompoundMap(metricCatalog);
  const compoundsByStem = new Map<string, string[]>();
  for (const fullName of metricCatalog) {
    const match = fullName.match(COMPOUND_METRIC_RE);
    if (match?.[1]) {
      const stem = match[1];
      const list = compoundsByStem.get(stem) ?? [];
      list.push(fullName);
      compoundsByStem.set(stem, list);
    }
  }

  const resolved: Array<{ stem: string; compound: string }> = [];
  const ambiguous = new Set<string>();
  const unmatched = new Set<string>();

  const rewritten = instructions.replace(METRIC_TOKEN_RE, (fullMatch, valuePart: string) => {
    const raw = stripMetricValue(valuePart);
    if (!raw) return fullMatch;

    const exact = stemMap.get(raw);
    if (exact && exact !== raw) {
      resolved.push({ stem: raw, compound: exact });
      const wrapped = valuePart.trim().startsWith("`");
      return wrapped ? `metric=\`${exact}\`` : `metric=${exact}`;
    }
    if (exact === raw) {
      return fullMatch;
    }

    const compounds = compoundsByStem.get(raw);
    if (compounds && compounds.length > 1) {
      ambiguous.add(raw);
      return fullMatch;
    }

    if (!COMPOUND_METRIC_RE.test(raw)) {
      unmatched.add(raw);
    }
    return fullMatch;
  });

  return {
    instructions: rewritten,
    resolved,
    ambiguous: [...ambiguous],
    unmatched: [...unmatched],
  };
}
