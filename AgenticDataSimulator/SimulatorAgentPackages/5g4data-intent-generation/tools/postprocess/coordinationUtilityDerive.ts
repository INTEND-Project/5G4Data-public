export type CoordinationQuantifier = "atLeast" | "smaller" | "larger";

export type CoordinationSeverity = "trivial" | "major" | "critical";

export type WeightProfile = "symmetric" | "weighted";

export interface ParsedCoordinationCondition {
  local: string;
  metricStem: string;
  metricLocal: string;
  quantifier: CoordinationQuantifier;
  threshold: number;
  unit: string;
}

export interface CoordinationDeriveFlags {
  coordinationSymmetric?: boolean;
  coordinationWeighted?: boolean;
  coordinationSeverityCritical?: boolean;
  coordinationSeverityTrivial?: boolean;
}

export interface SubUtilitySpec {
  argLocal: string;
  mfFunction: "logistic" | "poly";
  k: number;
  limit: number;
  midpointQuantity: string;
  standardK: number;
  x0Fraction: number;
}

const ENERGY_STEM_PATTERN = /joule|watt|energy|power|consumption/i;
const NETWORK_STEM_PATTERN = /bandwidth|latency|network/i;

export function isNetworkMetricStem(metricStem: string): boolean {
  return NETWORK_STEM_PATTERN.test(metricStem);
}

export function expectationPrefixForMetricStem(metricStem: string): "DE" | "NE" | "SE" {
  if (isNetworkMetricStem(metricStem)) return "NE";
  if (ENERGY_STEM_PATTERN.test(metricStem)) return "SE";
  return "DE";
}

export function metricStemFromScopedLocal(metricLocal: string): string {
  const withoutPrefix = metricLocal.replace(/^data5g:/i, "");
  return withoutPrefix.replace(/_CO[A-Za-z0-9_]+$/, "");
}

export function argLocalFromMetricStem(metricStem: string): string {
  return `U_arg_${metricStem}`;
}

export function resolveSeverity(flags: CoordinationDeriveFlags): CoordinationSeverity {
  if (flags.coordinationSeverityCritical) return "critical";
  if (flags.coordinationSeverityTrivial) return "trivial";
  return "major";
}

export function severityParams(severity: CoordinationSeverity): {
  standardK: number;
  x0Fraction: number;
} {
  switch (severity) {
    case "trivial":
      return { standardK: 5, x0Fraction: 0.8 };
    case "critical":
      return { standardK: 30, x0Fraction: 0.95 };
    default:
      return { standardK: 12, x0Fraction: 0.85 };
  }
}

export function resolveWeightProfile(flags: CoordinationDeriveFlags): WeightProfile {
  if (flags.coordinationWeighted && !flags.coordinationSymmetric) return "weighted";
  if (flags.coordinationSymmetric && !flags.coordinationWeighted) return "symmetric";
  if (flags.coordinationWeighted) return "weighted";
  return "symmetric";
}

function formatQuantity(value: number, unit: string): string {
  const trimmedUnit = unit.trim();
  if (!trimmedUnit) {
    return `"${value}"^^xsd:decimal`;
  }
  return `"${value}${trimmedUnit}"^^quan:quantity`;
}

export function computeMidpointQuantity(
  quantifier: CoordinationQuantifier,
  threshold: number,
  x0Fraction: number,
  unit: string,
): number {
  if (quantifier === "atLeast" || quantifier === "larger") {
    return Math.ceil(x0Fraction * threshold);
  }
  return Math.ceil(threshold * (2 - x0Fraction));
}

export function computeSignedK(
  quantifier: CoordinationQuantifier,
  threshold: number,
  standardK: number,
): number {
  const magnitude = threshold > 0 ? standardK / threshold : standardK;
  if (quantifier === "smaller") {
    return -magnitude;
  }
  return magnitude;
}

function primaryMetricIndex(conditions: ParsedCoordinationCondition[], userText: string): number {
  const lowered = userText.toLowerCase();
  for (let index = 0; index < conditions.length; index += 1) {
    const stem = conditions[index].metricStem.toLowerCase();
    if (lowered.includes(stem)) return index;
  }
  const keywords = [
    { pattern: /throughput|tps|token/, stem: /tps|token|throughput/i },
    { pattern: /latency|ms\b/, stem: /latency/i },
    { pattern: /joule|energy|power|watt|consumption/, stem: ENERGY_STEM_PATTERN },
  ];
  for (const { pattern, stem } of keywords) {
    if (pattern.test(lowered)) {
      const idx = conditions.findIndex((c) => stem.test(c.metricStem));
      if (idx >= 0) return idx;
    }
  }
  return 0;
}

export function resolveLimits(
  conditions: ParsedCoordinationCondition[],
  profile: WeightProfile,
  userText: string,
): number[] {
  const n = conditions.length;
  if (n === 0) return [];
  if (profile === "symmetric") {
    const share = 1 / n;
    return conditions.map(() => Number(share.toFixed(4)));
  }
  if (n === 1) return [1];
  const primary = primaryMetricIndex(conditions, userText);
  const primaryLimit = 0.7;
  const remainder = 1 - primaryLimit;
  const secondaryShare = remainder / (n - 1);
  return conditions.map((_, index) =>
    Number((index === primary ? primaryLimit : secondaryShare).toFixed(4)),
  );
}

export function resolveMfFunction(
  condition: ParsedCoordinationCondition,
  profile: WeightProfile,
  isPrimary: boolean,
): "logistic" | "poly" {
  if (profile === "weighted" && !isPrimary && ENERGY_STEM_PATTERN.test(condition.metricStem)) {
    return "poly";
  }
  return "logistic";
}

export function buildSubUtilitySpecs(
  conditions: ParsedCoordinationCondition[],
  flags: CoordinationDeriveFlags,
  userText = "",
): SubUtilitySpec[] {
  const severity = resolveSeverity(flags);
  const { standardK, x0Fraction } = severityParams(severity);
  const profile = resolveWeightProfile(flags);
  const limits = resolveLimits(conditions, profile, userText);
  const primaryIndex = profile === "weighted" ? primaryMetricIndex(conditions, userText) : -1;

  return conditions.map((condition, index) => {
    const midpoint = computeMidpointQuantity(
      condition.quantifier,
      condition.threshold,
      x0Fraction,
      condition.unit,
    );
    return {
      argLocal: argLocalFromMetricStem(condition.metricStem),
      mfFunction: resolveMfFunction(condition, profile, index === primaryIndex),
      k: computeSignedK(condition.quantifier, condition.threshold, standardK),
      limit: limits[index] ?? 0.5,
      midpointQuantity: formatQuantity(midpoint, condition.unit),
      standardK,
      x0Fraction,
    };
  });
}

export function formatDecimal(value: number): string {
  const rounded = Math.abs(value) < 0.0001 ? 0 : value;
  const text = rounded.toFixed(6).replace(/\.?0+$/, "");
  return `"${text}"^^xsd:decimal`;
}
