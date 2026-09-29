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

function newUuid4Hex(): string {
  return randomUUID().replace(/-/g, "");
}

/** Placeholder token embedded in Turtle local names (`__ID_...__`). */
const PLACEHOLDER_TOKEN = String.raw`__ID_[A-Za-z0-9_]+__`;

/**
 * data5g local with a trailing 32-hex suffix (I/CO/DE/… or scoped names like
 * bandwidth_CO… / member_CO… / TenMinuteReportEvent_RE…).
 */
const DATA5G_HEX_LOCAL = /\bdata5g:([A-Za-z][A-Za-z0-9_-]*?)([0-9a-fA-F]{32})\b/g;

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

/**
 * Remint every 32-hex suffix on data5g: locals to a fresh UUIDv4 hex.
 * The same old suffix always maps to the same new suffix so related locals
 * (CO / member_CO / bandwidth_CO, RE / TenMinuteReportEvent_RE, …) stay linked.
 */
function remintAllHexSuffixes(text: string): { text: string; remapped: number } {
  const suffixMap = new Map<string, string>();
  const mapSuffix = (old: string): string => {
    const key = old.toLowerCase();
    let next = suffixMap.get(key);
    if (!next) {
      next = newUuid4Hex();
      suffixMap.set(key, next);
    }
    return next;
  };

  const out = text.replace(DATA5G_HEX_LOCAL, (_full, prefix: string, suffix: string) => {
    return `data5g:${prefix}${mapSuffix(suffix)}`;
  });
  return { text: out, remapped: suffixMap.size };
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
      placeholderSuffixMap.set(placeholder, newUuid4Hex());
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

  // Phase 2: rewrite any remaining invalid (non-32-hex) UUID local-name suffixes.
  for (const rule of identifierRules) {
    if (!rule.validateAsUuid4Suffix) continue;
    const pattern = new RegExp(rule.regex, "g");
    const cache = new Map<string, string>();
    rewritten = rewritten.replace(pattern, (full, prefix, suffix) => {
      const suffixText = String(suffix ?? "").trim();
      if (/^[0-9a-fA-F]{32}$/.test(suffixText)) return full;
      if (!cache.has(full)) {
        cache.set(full, `data5g:${String(prefix ?? "")}${newUuid4Hex()}`);
      }
      return cache.get(full) as string;
    });
    changes += cache.size;
  }

  // Phase 3: remint ALL 32-hex suffixes on data5g locals to fresh random UUIDv4s.
  // Keeps shared suffixes consistent across related identifiers.
  const reminted = remintAllHexSuffixes(rewritten);
  rewritten = reminted.text;
  changes += reminted.remapped;

  // Defensive: if any reminted suffix somehow fails uuid4 checks, fix individually.
  rewritten = rewritten.replace(DATA5G_HEX_LOCAL, (full, prefix: string, suffix: string) => {
    if (isUuid4Hex(suffix)) return full;
    return `data5g:${prefix}${newUuid4Hex()}`;
  });

  return {
    text: rewritten,
    changes,
    note:
      changes > 0
        ? "rewrote placeholders/invalid locals and reminted all data5g uuid4 suffixes"
        : undefined
  };
}
