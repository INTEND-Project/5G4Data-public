import type { IntentDraft, IntentDraftFragment } from "./assembleIntent.js";
import {
  coordinationMetricCategory,
  isDeprecatedSustainabilityMetricStem,
  isThroughputMetricStem,
  metricStemsAlignForCoordination,
  type CoordinationMetricCategory,
  type ParsedCoordinationCondition
} from "./postprocess/coordinationUtilityDerive.js";

export type DraftConditionRef = {
  local: string;
  metricStem: string;
  fragmentId: string;
  category: CoordinationMetricCategory;
};

const CATEGORY_PROMPT_PATTERNS: Record<CoordinationMetricCategory, RegExp> = {
  throughput: /throughput|token|\btps\b|p99/i,
  energy: /energy|joule|watt|power|consumption|sustain/i,
  network: /bandwidth|latency|network|qos|connectivity/i,
  other: /(?!)/,
};

function extractSubjectBlock(turtle: string, local: string): string {
  const pattern = new RegExp(
    `data5g:${local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+a[\\s\\S]*?\\.`,
    "i"
  );
  return turtle.match(pattern)?.[0] ?? "";
}

function inferMetricStemFromDescription(block: string): string {
  const description = block.match(/dct:description\s+"([^"]+)"/i)?.[1] ?? "";
  const token = description.toLowerCase();
  if (/token|throughput|p99/.test(token)) return "p99-token-target";
  if (/energy/.test(token)) return "energy-consumption";
  if (/power/.test(token)) return "power-consumption";
  if (/latency|bandwidth|network/.test(token)) return "networklatency";
  return "unknown";
}

export function parseDraftFragmentConditions(draft: IntentDraft): DraftConditionRef[] {
  const out: DraftConditionRef[] = [];
  for (const fragment of draft.fragments) {
    for (const match of fragment.turtle.matchAll(
      /\bdata5g:(CO[A-Za-z0-9_]+)\s+a\s+icm:Condition\b/gi
    )) {
      const local = match[1];
      if (!local) continue;
      const block = extractSubjectBlock(fragment.turtle, local);
      const propertyMatch = block.match(/\bdata5g:([a-z0-9][a-z0-9-]*)_CO/i);
      const metricStem = propertyMatch?.[1] ?? inferMetricStemFromDescription(block);
      out.push({
        local,
        metricStem,
        fragmentId: fragment.id,
        category: coordinationMetricCategory(metricStem)
      });
    }
  }
  return out;
}

function scorePromptMetricMatch(userPrompt: string, metricStem: string): number {
  const lowered = userPrompt.toLowerCase();
  const stem = metricStem.toLowerCase();
  let score = 0;
  if (lowered.includes(stem)) score += 10;
  const stemSpaced = stem.replace(/-/g, " ");
  if (lowered.includes(stemSpaced)) score += 8;
  for (const token of stem.split("-")) {
    if (token.length > 2 && lowered.includes(token)) score += 2;
  }
  const category = coordinationMetricCategory(metricStem);
  if (CATEGORY_PROMPT_PATTERNS[category].test(lowered)) score += 1;
  return score;
}

function pickBestDraftRef(pool: DraftConditionRef[], userPrompt: string): DraftConditionRef | undefined {
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const active = pool.filter((c) => !isDeprecatedSustainabilityMetricStem(c.metricStem));
  const candidates = active.length > 0 ? active : pool;
  return candidates.reduce((best, candidate) =>
    scorePromptMetricMatch(userPrompt, candidate.metricStem) >
    scorePromptMetricMatch(userPrompt, best.metricStem)
      ? candidate
      : best
  );
}

function pickBestParsed(
  pool: ParsedCoordinationCondition[],
  userPrompt: string
): ParsedCoordinationCondition | undefined {
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const active = pool.filter((c) => !isDeprecatedSustainabilityMetricStem(c.metricStem));
  const candidates = active.length > 0 ? active : pool;
  return candidates.reduce((best, candidate) =>
    scorePromptMetricMatch(userPrompt, candidate.metricStem) >
    scorePromptMetricMatch(userPrompt, best.metricStem)
      ? candidate
      : best
  );
}

function promptMentionsCategory(userPrompt: string, category: CoordinationMetricCategory): boolean {
  return CATEGORY_PROMPT_PATTERNS[category].test(userPrompt);
}

function genericCoordinationPrompt(userPrompt: string): boolean {
  return /coordination|coordinate|incord|symmetric|weighted/.test(userPrompt.toLowerCase());
}

function targetCategoriesFromPrompt(
  userPrompt: string,
  pool: DraftConditionRef[],
  draft?: IntentDraft
): CoordinationMetricCategory[] {
  const kindMentions = (["deployment", "sustainability", "network"] as const).filter(
    (kind) =>
      new RegExp(`\\b${kind}\\b`, "i").test(userPrompt) &&
      pool.some((c) => c.fragmentId === kind)
  );
  if (kindMentions.length >= 2) {
    const categories: CoordinationMetricCategory[] = [];
    for (const kind of kindMentions) {
      const fragPool = pool.filter((c) => c.fragmentId === kind);
      const preferred =
        kind === "deployment"
          ? fragPool.find((c) => c.category === "throughput")
          : kind === "sustainability"
            ? fragPool.find((c) => c.category === "energy")
            : fragPool.find((c) => c.category === "network");
      const category = preferred?.category ?? fragPool[0]?.category;
      if (category && category !== "other") categories.push(category);
    }
    return [...new Set(categories)];
  }

  const mentioned = (["throughput", "energy", "network"] as CoordinationMetricCategory[]).filter(
    (cat) => promptMentionsCategory(userPrompt, cat) && pool.some((c) => c.category === cat)
  );
  if (mentioned.length > 0) return mentioned;

  if (genericCoordinationPrompt(userPrompt) && draft) {
    const categories: CoordinationMetricCategory[] = [];
    if (draft.fragments.some((f) => f.id === "deployment")) {
      if (pool.some((c) => c.fragmentId === "deployment" && c.category === "throughput")) {
        categories.push("throughput");
      } else if (pool.some((c) => c.fragmentId === "deployment")) {
        categories.push(pool.find((c) => c.fragmentId === "deployment")!.category);
      }
    }
    if (draft.fragments.some((f) => f.id === "sustainability")) {
      if (pool.some((c) => c.category === "energy")) categories.push("energy");
    }
    if (draft.fragments.some((f) => f.id === "network")) {
      if (pool.some((c) => c.category === "network")) categories.push("network");
    }
    return [...new Set(categories)];
  }

  const fromPool = [...new Set(pool.map((c) => c.category).filter((c) => c !== "other"))];
  return fromPool.slice(0, 3);
}

function selectFromDraftRefs(refs: DraftConditionRef[], userPrompt: string, draft: IntentDraft): string[] {
  const explicitlyNamed = refs.filter((ref) =>
    promptExplicitlyNamesMetricStem(userPrompt, ref.metricStem)
  );
  if (explicitlyNamed.length >= 2) {
    const selected: string[] = [];
    for (const ref of explicitlyNamed) {
      if (selected.includes(ref.local)) continue;
      const category = ref.category;
      const sameCategory = selected
        .map((local) => refs.find((r) => r.local === local)!)
        .filter((picked) => picked.category === category);
      if (sameCategory.length === 0) {
        selected.push(ref.local);
        continue;
      }
      if (sameCategory.every((picked) => picked.metricStem !== ref.metricStem)) {
        selected.push(ref.local);
      }
    }
    if (selected.length >= 2) return selected;
  }

  const categories = targetCategoriesFromPrompt(userPrompt, refs, draft);
  const selected: string[] = [];
  for (const category of categories) {
    const pool = refs.filter(
      (c) =>
        c.category === category &&
        !selected.some((local) => {
          const picked = refs.find((r) => r.local === local);
          return picked && metricStemsAlignForCoordination(picked.metricStem, c.metricStem);
        })
    );
    const hit = pickBestDraftRef(pool, userPrompt);
    if (hit && !selected.includes(hit.local)) selected.push(hit.local);
  }
  if (selected.length === 0 && refs.length > 0) {
    return [pickBestDraftRef(refs, userPrompt)!.local];
  }
  return selected;
}

function targetCategoriesForParsed(
  userPrompt: string,
  available: ParsedCoordinationCondition[]
): CoordinationMetricCategory[] {
  const mentioned = (["throughput", "energy", "network"] as CoordinationMetricCategory[]).filter(
    (cat) =>
      promptMentionsCategory(userPrompt, cat) &&
      available.some((c) => coordinationMetricCategory(c.metricStem) === cat)
  );
  if (mentioned.length > 0) return mentioned;
  if (genericCoordinationPrompt(userPrompt)) {
    const cats = new Set<CoordinationMetricCategory>();
    for (const condition of available) {
      const cat = coordinationMetricCategory(condition.metricStem);
      if (cat !== "other") cats.add(cat);
    }
    return [...cats];
  }
  return [...new Set(available.map((c) => coordinationMetricCategory(c.metricStem)).filter((c) => c !== "other"))];
}

export function selectCoordinationMetrics(input: {
  draft: IntentDraft;
  userPrompt: string;
}): string[] {
  const refs = parseDraftFragmentConditions(input.draft);
  return selectFromDraftRefs(refs, input.userPrompt, input.draft);
}

const METRIC_STEM_HINT_WORDS = [
  "compute",
  "network",
  "latency",
  "throughput",
  "energy",
  "consumption",
  "token",
  "bandwidth",
  "power",
  "joule",
];

function stemHintWords(metricStem: string): string[] {
  const stem = metricStem.toLowerCase();
  const hints = METRIC_STEM_HINT_WORDS.filter((word) => stem.includes(word));
  return hints.length > 0 ? hints : stem.split("-").filter((token) => token.length > 3);
}

function promptExplicitlyNamesMetricStem(userPrompt: string, metricStem: string): boolean {
  const lowered = userPrompt.toLowerCase();
  const stem = metricStem.toLowerCase();
  if (lowered.includes(stem)) return true;
  const stemSpaced = stem.replace(/-/g, " ");
  if (lowered.includes(stemSpaced)) return true;
  const stemTokens = stem.split("-").filter((token) => token.length > 2);
  if (stemTokens.length > 0 && stemTokens.every((token) => lowered.includes(token))) return true;
  const hints = stemHintWords(metricStem);
  return hints.length >= 2 && hints.every((word) => lowered.includes(word));
}

function promptMentionsMetricStem(userPrompt: string, metricStem: string): boolean {
  if (promptExplicitlyNamesMetricStem(userPrompt, metricStem)) return true;
  const lowered = userPrompt.toLowerCase();
  const hints = stemHintWords(metricStem);
  if (hints.length === 1 && lowered.includes(hints[0]!)) return true;
  return CATEGORY_PROMPT_PATTERNS[coordinationMetricCategory(metricStem)].test(lowered);
}

export function selectCoordinationConditionsFromPool(
  available: ParsedCoordinationCondition[],
  userPrompt: string
): ParsedCoordinationCondition[] {
  const explicitlyNamed = available.filter((condition) =>
    promptExplicitlyNamesMetricStem(userPrompt, condition.metricStem)
  );
  if (explicitlyNamed.length >= 2) {
    const selected: ParsedCoordinationCondition[] = [];
    for (const condition of explicitlyNamed) {
      if (selected.some((picked) => picked.local === condition.local)) continue;
      const category = coordinationMetricCategory(condition.metricStem);
      const sameCategory = selected.filter(
        (picked) => coordinationMetricCategory(picked.metricStem) === category
      );
      if (sameCategory.length === 0) {
        selected.push(condition);
        continue;
      }
      if (sameCategory.every((picked) => picked.metricStem !== condition.metricStem)) {
        selected.push(condition);
      }
    }
    if (selected.length >= 2) return selected;
  }

  const categories = targetCategoriesForParsed(userPrompt, available);
  const selected: ParsedCoordinationCondition[] = [];
  for (const category of categories) {
    const pool = available.filter((c) => {
      if (coordinationMetricCategory(c.metricStem) !== category) return false;
      return !selected.some((picked) =>
        metricStemsAlignForCoordination(picked.metricStem, c.metricStem)
      );
    });
    const hit = pickBestParsed(pool, userPrompt);
    if (hit) selected.push(hit);
  }
  if (selected.length === 0 && available.length > 0) {
    const hit = pickBestParsed(available, userPrompt);
    if (hit) return [hit];
  }
  return selected;
}

export function draftRefToMinimalParsed(ref: DraftConditionRef): ParsedCoordinationCondition {
  return {
    local: ref.local,
    metricStem: ref.metricStem,
    metricLocal: `data5g:${ref.metricStem}_${ref.local}`,
    quantifier: isThroughputMetricStem(ref.metricStem) ? "larger" : "smaller",
    threshold: 1,
    unit: ""
  };
}
