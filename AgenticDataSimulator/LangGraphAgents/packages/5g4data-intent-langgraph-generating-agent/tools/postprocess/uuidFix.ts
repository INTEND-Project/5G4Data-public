import { randomUUID } from "node:crypto";
import {
  collectKnownMetricStems,
  normalizeConditionScopedMetricNamesFromCatalogue
} from "../metricNaming.js";

function isUuid4Hex(hex: string): boolean {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return false;
  const versionNibble = hex[12]?.toLowerCase();
  const variantNibble = hex[16]?.toLowerCase();
  return versionNibble === "4" && ["8", "9", "a", "b"].includes(variantNibble ?? "");
}

/** Placeholder token embedded in Turtle local names (`__ID_...__`). */
const PLACEHOLDER_TOKEN = String.raw`__ID_[A-Za-z0-9_]+__`;

/** Ensure icm:valuesOfTargetProperty locals include the CO prefix before condition id. */
function normalizeConditionScopedMetricNames(text: string): string {
  return text.replace(
    new RegExp(
      String.raw`(valuesOfTargetProperty\s+data5g:[^\s;,]+)_(?!CO)(${PLACEHOLDER_TOKEN}|[0-9a-fA-F]{32})\b`,
      "g"
    ),
    "$1_CO$2"
  );
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    runtimeContext?: string;
    knownMetricStems?: string[];
    workloadCatalogBaseUrl?: string;
    validatorRules: {
      identifierRules?: Array<{
        regex: string;
        validateAsUuid4Suffix?: boolean;
      }>;
    };
  };
}): { text: string; changes: number; note?: string } {
  const identifierRules = args.context.validatorRules.identifierRules ?? [];
  let rewritten = args.text;
  let changes = 0;

  // Phase 1: replace explicit placeholder tokens so the LLM can keep references stable.
  const placeholderSuffixMap = new Map<string, string>();
  const getOrCreateSuffix = (placeholder: string): string => {
    if (!placeholderSuffixMap.has(placeholder)) {
      placeholderSuffixMap.set(placeholder, randomUUID().replace(/-/g, ""));
    }
    return placeholderSuffixMap.get(placeholder) as string;
  };

  rewritten = rewritten.replace(
    new RegExp(String.raw`\bdata5g:(I|CO|CX|DE|NE|RE|RG|SE|CE)(${PLACEHOLDER_TOKEN})\b`, "g"),
    (_full, prefix, placeholder) => `data5g:${String(prefix)}${getOrCreateSuffix(String(placeholder))}`
  );

  // Also rewrite embedded placeholders used in scoped target-property names.
  // Example: data5g:detection-latency_CO__ID_CONDITION_DETECTION_1__
  rewritten = normalizeConditionScopedMetricNames(rewritten);
  rewritten = rewritten.replace(new RegExp(PLACEHOLDER_TOKEN, "g"), (placeholder) =>
    getOrCreateSuffix(placeholder)
  );
  rewritten = normalizeConditionScopedMetricNames(rewritten);
  const knownMetricStems = collectKnownMetricStems({
    runtimeContext: args.context.runtimeContext ?? "",
    text: rewritten,
    explicitStems: args.context.knownMetricStems
  });
  rewritten = normalizeConditionScopedMetricNamesFromCatalogue(rewritten, knownMetricStems);
  changes += placeholderSuffixMap.size;

  // Phase 2: rewrite any remaining invalid UUID local-name suffixes.
  for (const rule of identifierRules) {
    if (!rule.validateAsUuid4Suffix) continue;
    const pattern = new RegExp(rule.regex, "g");
    const cache = new Map<string, string>();
    rewritten = rewritten.replace(pattern, (full, prefix, suffix) => {
      const suffixText = String(suffix ?? "").trim();
      if (isUuid4Hex(suffixText)) return full;
      if (!cache.has(full)) {
        const fixed = randomUUID().replace(/-/g, "");
        cache.set(full, `data5g:${String(prefix ?? "")}${fixed}`);
      }
      return cache.get(full) as string;
    });
    changes += cache.size;
  }

  return {
    text: rewritten,
    changes,
    note:
      changes > 0
        ? "rewrote placeholder/invalid local-name identifiers to UUIDv4 suffixes"
        : undefined
  };
}
