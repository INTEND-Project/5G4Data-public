import { randomUUID } from "node:crypto";

function isUuid4Hex(hex: string): boolean {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return false;
  const versionNibble = hex[12]?.toLowerCase();
  const variantNibble = hex[16]?.toLowerCase();
  return versionNibble === "4" && ["8", "9", "a", "b"].includes(variantNibble ?? "");
}

export function applyPostprocessor(args: {
  text: string;
  context: {
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
    /\bdata5g:(I|CO|CX|DE|NE|RE|RG|SE)(__ID_[A-Z0-9_]+__)\b/g,
    (_full, prefix, placeholder) => `data5g:${String(prefix)}${getOrCreateSuffix(String(placeholder))}`
  );

  // Also rewrite embedded placeholders used in scoped target-property names.
  // Example: data5g:detection-latency_CO__ID_CONDITION_DETECTION_1__
  rewritten = rewritten.replace(/__ID_[A-Z0-9_]+__/g, (placeholder) => getOrCreateSuffix(placeholder));
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
