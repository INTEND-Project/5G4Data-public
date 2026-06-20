import {
  argLocalFromMetricStem,
  buildSubUtilitySpecs,
  coordinationMetricCategory,
  expectationPrefixForMetricStem,
  isDeprecatedSustainabilityMetricStem,
  metricStemFromScopedLocal,
  metricStemsAlignForCoordination,
  type CoordinationDeriveFlags,
  type ParsedCoordinationCondition,
  type SubUtilitySpec,
  formatDecimal,
} from "./coordinationUtilityDerive.js";
import { selectCoordinationConditionsFromPool } from "../selectCoordinationMetrics.js";
import {
  isCoordinationUtilityFunctionLocal,
  isCoordinationUtilityInfoLocal,
  isCoordinationUtilityProfileLocal,
  isUtilitySubjectLocal,
  resolveCoordinationUtilityLocals,
  UTILITY_INFO_LINK_LOCAL_PATTERN,
  UTILITY_SUBJECT_LOCAL_PATTERN,
  type CoordinationUtilityLocals,
} from "./intentUtilityLocals.js";

function isNewSubjectLine(line: string, currentLocal: string | null): boolean {
  const match = line.match(/^\s*data5g:([A-Za-z0-9_]+)\s+a\b/i);
  if (!match?.[1]) return false;
  return currentLocal === null || match[1] !== currentLocal;
}

function extractSubjectBlock(text: string, local: string): string | null {
  const lines = text.split("\n");
  const subjectRe = new RegExp(String.raw`^\s*data5g:${local}\s+a\b`, "i");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (subjectRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const end = skipSubjectBlockLines(lines, start, local);
  return lines.slice(start, end).join("\n");
}

function extractLocalsFromAllOf(block: string): string[] {
  const match = block.match(/log:allOf\s+([^;]+)/is);
  if (!match?.[1]) return [];
  return [...match[1].matchAll(/data5g:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

function parseConditionBlock(block: string, local: string): ParsedCoordinationCondition | null {
  const metricMatch = block.match(
    /valuesOfTargetProperty\s+(data5g:[^\s;]+)[\s\S]*?quan:(atLeast|smaller|larger)\s*\[[^\]]*?(?:quan:unit\s+"([^"]*)"\s*;\s*)?rdf:value\s+([0-9.]+)/is,
  );
  if (!metricMatch) return null;
  const metricLocal = metricMatch[1];
  return {
    local,
    metricLocal,
    metricStem: metricStemFromScopedLocal(metricLocal),
    quantifier: metricMatch[2] as ParsedCoordinationCondition["quantifier"],
    unit: metricMatch[3]?.trim() ?? "",
    threshold: Number.parseFloat(metricMatch[4]),
  };
}

function parseConditionBlockMetricOnly(
  block: string,
  local: string,
): Pick<ParsedCoordinationCondition, "local" | "metricLocal" | "metricStem"> | null {
  const metricMatch = block.match(/valuesOfTargetProperty\s+(data5g:[^\s;\]]+)/i);
  if (!metricMatch) return null;
  const metricLocal = metricMatch[1];
  return {
    local,
    metricLocal,
    metricStem: metricStemFromScopedLocal(metricLocal),
  };
}

function findAllConditionLocals(text: string): string[] {
  return [...text.matchAll(/\bdata5g:(CO[A-Za-z0-9_]+)\s+a\b/gi)].map((m) => m[1]);
}

function resolveConditionForCoordination(
  text: string,
  ceConditionLocal: string,
): ParsedCoordinationCondition | null {
  const ceBlock = extractSubjectBlock(text, ceConditionLocal);
  if (!ceBlock) return null;

  const withQuantifier = parseConditionBlock(ceBlock, ceConditionLocal);
  if (withQuantifier) return withQuantifier;

  const metricOnly = parseConditionBlockMetricOnly(ceBlock, ceConditionLocal);
  if (!metricOnly) return null;

  const sourcedMatches: ParsedCoordinationCondition[] = [];
  for (const local of findAllConditionLocals(text)) {
    if (local === ceConditionLocal) continue;
    const block = extractSubjectBlock(text, local);
    if (!block) continue;
    const sourced = parseConditionBlock(block, local);
    if (!sourced || !metricStemsAlignForCoordination(metricOnly.metricStem, sourced.metricStem)) continue;
    sourcedMatches.push(sourced);
  }
  const preferredSourced =
    sourcedMatches.find((sourced) => !isDeprecatedSustainabilityMetricStem(sourced.metricStem)) ??
    sourcedMatches[0];
  if (!preferredSourced) return null;
  return {
    local: ceConditionLocal,
    metricLocal: metricOnly.metricLocal,
    metricStem: metricOnly.metricStem,
    quantifier: preferredSourced.quantifier,
    unit: preferredSourced.unit,
    threshold: preferredSourced.threshold,
  };

  return null;
}

function coordinationConditionLocals(text: string): Set<string> {
  const ceLocal = findCoordinationExpectationLocal(text);
  if (!ceLocal) return new Set();
  const ceBlock = extractSubjectBlock(text, ceLocal);
  if (!ceBlock) return new Set();
  return new Set(extractLocalsFromAllOf(ceBlock).filter((local) => local.startsWith("CO")));
}

function collectExpectationConditions(text: string): ParsedCoordinationCondition[] {
  const ceConditionLocals = coordinationConditionLocals(text);
  const conditions: ParsedCoordinationCondition[] = [];
  for (const local of findAllConditionLocals(text)) {
    if (ceConditionLocals.has(local) && !isExpectationOwnedCondition(text, local)) continue;
    const block = extractSubjectBlock(text, local);
    if (!block) continue;
    const parsed = parseConditionBlock(block, local);
    if (parsed) conditions.push(parsed);
  }
  return conditions;
}

function buildCoordinationAvailablePool(
  text: string,
  parsedFromCe: ParsedCoordinationCondition[],
): ParsedCoordinationCondition[] {
  const available = dedupeByLocal(collectExpectationConditions(text));
  for (const ceParsed of parsedFromCe) {
    if (
      available.some(
        (condition) =>
          condition.local === ceParsed.local ||
          metricStemsAlignForCoordination(condition.metricStem, ceParsed.metricStem),
      )
    ) {
      continue;
    }
    const resolved = resolveConditionForCoordination(text, ceParsed.local) ?? ceParsed;
    available.push(resolved);
  }
  return dedupeByLocal(available);
}

function dedupeByLocal(conditions: ParsedCoordinationCondition[]): ParsedCoordinationCondition[] {
  const seen = new Set<string>();
  const out: ParsedCoordinationCondition[] = [];
  for (const condition of conditions) {
    if (seen.has(condition.local)) continue;
    seen.add(condition.local);
    out.push(condition);
  }
  return out;
}

function isExpectationOwnedCondition(text: string, conditionLocal: string): boolean {
  return findExpectationLocalContainingCondition(text, conditionLocal) !== null;
}

const CATEGORY_PROMPT_PATTERNS: Record<
  ReturnType<typeof coordinationMetricCategory>,
  RegExp
> = {
  throughput: /throughput|token|\btps\b|p99/i,
  energy: /energy|joule|watt|power|consumption|sustain/i,
  network: /bandwidth|latency|network|qos|connectivity/i,
  other: /(?!)/,
};

function promptMentionsCondition(userText: string, condition: ParsedCoordinationCondition): boolean {
  const lowered = userText.toLowerCase();
  const stem = condition.metricStem.toLowerCase();
  const stemSpaced = stem.replace(/-/g, " ");
  if (lowered.includes(stem) || lowered.includes(stemSpaced)) return true;
  const category = coordinationMetricCategory(condition.metricStem);
  return CATEGORY_PROMPT_PATTERNS[category].test(lowered);
}

function scorePromptMetricMatch(userText: string, condition: ParsedCoordinationCondition): number {
  const lowered = userText.toLowerCase();
  const stem = condition.metricStem.toLowerCase();
  let score = 0;
  if (lowered.includes(stem)) score += 10;
  const stemSpaced = stem.replace(/-/g, " ");
  if (lowered.includes(stemSpaced)) score += 8;
  for (const token of stem.split("-")) {
    if (token.length > 2 && lowered.includes(token)) score += 2;
  }
  if (promptMentionsCondition(userText, condition)) score += 1;
  return score;
}

function pickBestFromCandidates(
  candidates: ParsedCoordinationCondition[],
  userText: string,
): ParsedCoordinationCondition | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const active = candidates.filter(
    (condition) => !isDeprecatedSustainabilityMetricStem(condition.metricStem),
  );
  const pool = active.length > 0 ? active : candidates;
  return pool.reduce((best, candidate) =>
    scorePromptMetricMatch(userText, candidate) > scorePromptMetricMatch(userText, best)
      ? candidate
      : best,
  );
}

function hasAlignedMetricStem(
  conditions: ParsedCoordinationCondition[],
  metricStem: string,
): boolean {
  return conditions.some((condition) =>
    metricStemsAlignForCoordination(condition.metricStem, metricStem),
  );
}

function findMatchingExpectationCondition(
  available: ParsedCoordinationCondition[],
  metricStem: string,
  userText: string,
): ParsedCoordinationCondition | undefined {
  const exact = available.find((condition) => condition.metricStem === metricStem);
  if (exact) return exact;
  const aligned = available.filter((condition) =>
    metricStemsAlignForCoordination(metricStem, condition.metricStem),
  );
  return pickBestFromCandidates(aligned, userText);
}

function canonicalizeSingleCeCondition(
  text: string,
  ceParsed: ParsedCoordinationCondition,
  available: ParsedCoordinationCondition[],
  userText: string,
): ParsedCoordinationCondition | null {
  if (isExpectationOwnedCondition(text, ceParsed.local)) {
    const block = extractSubjectBlock(text, ceParsed.local);
    return block ? parseConditionBlock(block, ceParsed.local) : ceParsed;
  }
  return findMatchingExpectationCondition(available, ceParsed.metricStem, userText) ?? null;
}

function extractCoordinatesLocals(ceBlock: string): string[] {
  const match = ceBlock.match(/data5g:coordinates\s+([^;]+)/is);
  if (!match?.[1]) return [];
  return [...match[1].matchAll(/data5g:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

function collectConditionsFromExpectationLocals(
  text: string,
  expectationLocals: string[],
): ParsedCoordinationCondition[] {
  const out: ParsedCoordinationCondition[] = [];
  for (const expLocal of expectationLocals) {
    const block = extractSubjectBlock(text, expLocal);
    if (!block) continue;
    for (const coLocal of extractLocalsFromAllOf(block).filter((local) => local.startsWith("CO"))) {
      const coBlock = extractSubjectBlock(text, coLocal);
      if (!coBlock) continue;
      const parsed = parseConditionBlock(coBlock, coLocal);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function addPromptMatchedConditions(
  merged: ParsedCoordinationCondition[],
  available: ParsedCoordinationCondition[],
  userText: string,
): ParsedCoordinationCondition[] {
  const next = [...merged];
  for (const candidate of available) {
    if (!promptMentionsCondition(userText, candidate)) continue;
    const aligned = next.filter((condition) =>
      metricStemsAlignForCoordination(condition.metricStem, candidate.metricStem),
    );
    if (aligned.length === 0) {
      next.push(candidate);
      continue;
    }
    const bestExisting = pickBestFromCandidates(aligned, userText)!;
    if (scorePromptMetricMatch(userText, candidate) <= scorePromptMetricMatch(userText, bestExisting)) {
      continue;
    }
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (metricStemsAlignForCoordination(next[index].metricStem, candidate.metricStem)) {
        next.splice(index, 1);
      }
    }
    next.push(candidate);
  }
  return next;
}

function inferMissingCoordinationConditions(
  text: string,
  userText: string,
  conditions: ParsedCoordinationCondition[],
): ParsedCoordinationCondition[] {
  const available = collectExpectationConditions(text);
  let merged = dedupeByLocal([...conditions]);

  merged = addPromptMatchedConditions(merged, available, userText);

  if (merged.length < 2) {
    const ceLocal = findCoordinationExpectationLocal(text);
    const ceBlock = ceLocal ? extractSubjectBlock(text, ceLocal) : null;
    if (ceBlock) {
      const coordLocals = extractCoordinatesLocals(ceBlock);
      if (coordLocals.length > 0) {
        for (const condition of collectConditionsFromExpectationLocals(text, coordLocals)) {
          if (!hasAlignedMetricStem(merged, condition.metricStem)) {
            merged.push(condition);
          }
        }
      }
    }
  }

  if (merged.length < 2 && available.length >= 2) {
    const lowered = userText.toLowerCase();
    const genericCoord = /coordination|coordinate|incord|symmetric|weighted/.test(lowered);
    if (genericCoord || merged.length === 0) {
      for (const condition of available) {
        if (!hasAlignedMetricStem(merged, condition.metricStem)) {
          merged.push(condition);
        }
      }
    }
  }

  return dedupeByLocal(merged);
}

function canonicalizeCoordinationConditions(
  text: string,
  parsedFromCe: ParsedCoordinationCondition[],
  userText: string,
): ParsedCoordinationCondition[] {
  const available = buildCoordinationAvailablePool(text, parsedFromCe);
  const selected = selectCoordinationConditionsFromPool(available, userText);
  if (selected.length === 0) {
    return dedupeByLocal(
      parsedFromCe
        .map((ceParsed) => canonicalizeSingleCeCondition(text, ceParsed, available, userText))
        .filter((c): c is ParsedCoordinationCondition => c !== null),
    );
  }
  return selected.map((condition) => {
    const fromCe =
      parsedFromCe.find((ceParsed) => ceParsed.local === condition.local) ??
      parsedFromCe.find((ceParsed) => ceParsed.metricStem === condition.metricStem);
    if (fromCe) {
      return canonicalizeSingleCeCondition(text, fromCe, available, userText) ?? condition;
    }
    return (
      findMatchingExpectationCondition(available, condition.metricStem, userText) ?? condition
    );
  });
}

const DATA5G_IRI = "http://5g4data.eu/5g4data#";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeConditionSubjectBlocks(text: string, locals: Iterable<string>): string {
  let result = text;
  for (const local of locals) {
    const block = extractSubjectBlock(result, local);
    if (!block) continue;
    result = result.replace(block, "");
  }
  return result.replace(/\n{3,}/g, "\n\n");
}

function relatedOrphanArtifactLocals(text: string, orphanLocal: string): string[] {
  const pattern = new RegExp(
    String.raw`\bdata5g:([A-Za-z0-9_]*${escapeRegExp(orphanLocal)}[A-Za-z0-9_]*)\s+a\b`,
    "gi",
  );
  const locals = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const local = match[1];
    if (local === orphanLocal) continue;
    if (
      /duration|ReportEvent|Report/i.test(local) &&
      (local.includes(orphanLocal) || local.endsWith(orphanLocal))
    ) {
      locals.add(local);
    }
  }
  return [...locals];
}

function scrubListReferences(block: string, locals: string[]): string {
  let result = block;
  const iriBase = escapeRegExp(DATA5G_IRI);
  for (const local of locals) {
    const localPattern = escapeRegExp(local);
    result = result
      .replace(new RegExp(String.raw`,\s*data5g:${localPattern}\b`, "g"), "")
      .replace(new RegExp(String.raw`\bdata5g:${localPattern}\s*,`, "g"), "")
      .replace(new RegExp(String.raw`,\s*<${iriBase}${localPattern}>`, "g"), "")
      .replace(new RegExp(String.raw`<${iriBase}${localPattern}>\s*,`, "g"), "");
  }
  return result
    .replace(/,\s*,/g, ",")
    .replace(/;\s*rdfs:member\s*\]/gi, " ]")
    .replace(/icm:reportTriggers\s*\[\s*a\s+rdfs:Container\s*;\s*\]/gi, "");
}

function scrubOrphanReferencesFromReporting(text: string, locals: string[]): string {
  if (locals.length === 0) return text;
  const reHeader =
    /data5g:(RE(?:[0-9a-fA-F]{32}|[A-Za-z0-9_]+))\s+a\s+icm:ObservationReportingExpectation/gi;
  let result = text;
  let match: RegExpExecArray | null;
  while ((match = reHeader.exec(text)) !== null) {
    const reLocal = match[1];
    const block = extractSubjectBlock(result, reLocal);
    if (!block) continue;
    const scrubbed = scrubListReferences(block, locals);
    if (scrubbed !== block) {
      result = result.replace(block, scrubbed);
    }
  }
  return result;
}

function removeOrphanCoordinationArtifacts(text: string, orphanLocals: string[]): string {
  if (orphanLocals.length === 0) return text;
  const localsToStrip = new Set<string>(orphanLocals);
  for (const orphanLocal of orphanLocals) {
    for (const related of relatedOrphanArtifactLocals(text, orphanLocal)) {
      localsToStrip.add(related);
    }
  }
  let result = removeConditionSubjectBlocks(text, [...localsToStrip]);
  result = scrubOrphanReferencesFromReporting(result, [...localsToStrip]);
  return result.replace(/\n{3,}/g, "\n\n");
}

function findCoordinationExpectationLocal(text: string): string | null {
  const match = text.match(
    /\bdata5g:(CE[A-Za-z0-9_]+)\s+a[\s\S]*?CoordinationExpectation/is,
  );
  return match?.[1] ?? null;
}

type ExpectationKind = "DeploymentExpectation" | "NetworkExpectation" | "SustainabilityExpectation";

function findExpectationLocals(text: string, suffix: ExpectationKind): string[] {
  const prefix =
    suffix === "NetworkExpectation" ? "NE" : suffix === "SustainabilityExpectation" ? "SE" : "DE";
  const re = new RegExp(String.raw`\bdata5g:(${prefix}[A-Za-z0-9_]+)\s+a[\s\S]*?${suffix}`, "gi");
  return [...text.matchAll(re)].map((m) => m[1]);
}

function findExpectationLocalContainingCondition(
  text: string,
  conditionLocal: string,
): string | null {
  for (const suffix of [
    "DeploymentExpectation",
    "NetworkExpectation",
    "SustainabilityExpectation",
  ] as const) {
    for (const local of findExpectationLocals(text, suffix)) {
      const block = extractSubjectBlock(text, local);
      if (!block) continue;
      const allOf = block.match(/log:allOf\s+([^;]+)/is)?.[1] ?? "";
      if (allOf.includes(`data5g:${conditionLocal}`)) {
        return local;
      }
    }
  }
  return null;
}

function resolveCoordinateLocals(
  text: string,
  conditions: ParsedCoordinationCondition[],
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (local: string) => {
    if (!seen.has(local)) {
      seen.add(local);
      ordered.push(local);
    }
  };

  for (const condition of conditions) {
    const linked = findExpectationLocalContainingCondition(text, condition.local);
    if (linked) {
      push(linked);
      continue;
    }
    const prefix = expectationPrefixForMetricStem(condition.metricStem);
    const suffix =
      prefix === "NE"
        ? "NetworkExpectation"
        : prefix === "SE"
          ? "SustainabilityExpectation"
          : "DeploymentExpectation";
    const fallback = findExpectationLocals(text, suffix)[0];
    if (fallback) push(fallback);
  }

  return ordered;
}

function buildSubUtilityTurtle(spec: SubUtilitySpec, condition: ParsedCoordinationCondition): string {
  const k = formatDecimal(spec.k);
  const limit = formatDecimal(spec.limit);
  const standardK = formatDecimal(spec.standardK);
  const x0 = formatDecimal(spec.x0Fraction);
  return `        [ mf:${spec.mfFunction} ( data5g:${spec.argLocal}
                        ${k}
                        ${limit}
                        ${spec.midpointQuantity} );
          data5g:standardK ${standardK} ;
          data5g:x0Fraction ${x0} ]`;
}

function buildUtilityFunctionBlock(
  utilityFnLocal: string,
  specs: SubUtilitySpec[],
  conditions: ParsedCoordinationCondition[],
): string {
  const argNames = specs.map((s) => `data5g:${s.argLocal}`).join(" ");
  const subUtilities = specs
    .map((spec, index) => buildSubUtilityTurtle(spec, conditions[index]))
    .join("\n");
  return `data5g:${utilityFnLocal} a fun:function ;
    fun:argumentNames ( ${argNames} ) ;
    fun:argumentTypes ( quan:Quantity ) ;
    fun:resultType    quan:Quantity ;
    fun:arityMin ${specs.length} ; fun:arityMax ${specs.length} ;
    rdf:value [ quan:sum (
${subUtilities}
    ) ] .`;
}

function buildUtilityInformationBlock(
  specs: SubUtilitySpec[],
  conditions: ParsedCoordinationCondition[],
  utilityFnLocal: string,
  utilityLocals: CoordinationUtilityLocals,
): string {
  const argNames = specs.map((s) => `data5g:${s.argLocal}`).join(" ");
  const forMetricLines = specs
    .map(
      (spec, index) =>
        `    ut:forMetric      ( data5g:${spec.argLocal}    ${conditions[index].metricLocal} ) ;`,
    )
    .join("\n");
  return `data5g:${utilityLocals.uInfo}
    a ut:UtilityInformation ;
    ut:function       data5g:${utilityFnLocal} ;
    ut:withArguments  ( ${argNames} ) ;
${forMetricLines}
    ut:utilityProfile data5g:${utilityLocals.uProfile} .

data5g:${utilityLocals.uProfile} a ut:UtilityProfile ;
    ut:minUtility "0.0"^^xsd:decimal ;
    ut:maxUtility "1.0"^^xsd:decimal .`;
}

const UTILITY_FUNCTIONS_NS =
  "http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/";

function lineContainsUtilityFunctions(line: string): boolean {
  return (
    /UtilityFunctions\//i.test(line) ||
    /<http:\/\/tio\.models\.tmforum\.org\/tio\/v3\.6\.0\/UtilityFunctions\//i.test(line)
  );
}

/** Drop a Turtle subject block starting at line index i; returns next line index. */
function lineEndsSubjectTerminator(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed.endsWith(".")) return false;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
  }
  return !inString;
}

function skipSubjectBlockLines(
  lines: string[],
  start: number,
  currentLocal: string | null = subjectLocalFromLine(lines[start] ?? ""),
): number {
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (isNewSubjectLine(line, currentLocal)) {
      return i;
    }
    if (lineEndsSubjectTerminator(line)) {
      return i + 1;
    }
    i += 1;
  }
  return i;
}

function subjectLocalFromLine(line: string): string | null {
  const match = line.match(/^\s*data5g:([A-Za-z0-9_-]+)\b/);
  return match?.[1] ?? null;
}

function removeMisalignedUtilitySubjects(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const local = subjectLocalFromLine(line);

    if (local?.startsWith("U_arg_")) {
      i = skipSubjectBlockLines(lines, i) - 1;
      continue;
    }

    if (isCoordinationUtilityInfoLocal(local) || isCoordinationUtilityProfileLocal(local)) {
      const blockEnd = skipSubjectBlockLines(lines, i);
      const block = lines.slice(i, blockEnd).join("\n");
      if (lineContainsUtilityFunctions(block)) {
        i = blockEnd - 1;
        continue;
      }
      out.push(...lines.slice(i, blockEnd));
      i = blockEnd - 1;
      continue;
    }

    if (lineContainsUtilityFunctions(line)) {
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

/** LLMs sometimes emit UtilityFunctions/* instead of ut:/fun:/mf: — remove before rewrite. */
export function stripMisalignedUtilityTurtle(text: string): string {
  const utilityFnUtilityLink = new RegExp(
    String.raw`\s*<${UTILITY_FUNCTIONS_NS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}utility>\s+data5g:${UTILITY_INFO_LINK_LOCAL_PATTERN}\s*[;.]`,
    "gi",
  );

  return removeMisalignedUtilitySubjects(
    text.replace(utilityFnUtilityLink, "\n").replace(/\n{3,}/g, "\n\n"),
  ).replace(/\n{3,}/g, "\n\n");
}

const COMPLETE_MF_CALL_BODY =
  /^\s*(data5g:U_arg_[A-Za-z0-9_-]+)\s+("[^"]*"\^\^xsd:decimal)\s+("[^"]*"\^\^xsd:decimal)\s+("[^"]*"\^\^quan:quantity)\s*$/s;

function extractMfCallBodies(block: string): string[] {
  const bodies: string[] = [];
  const re = /mf:(?:logistic|poly)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < block.length && depth > 0) {
      const char = block[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      index += 1;
    }
    if (depth === 0) {
      bodies.push(block.slice(start, index - 1));
    }
  }
  return bodies;
}

export function isCompleteMfLogisticCall(callBody: string): boolean {
  return COMPLETE_MF_CALL_BODY.test(callBody.trim());
}

function isCompleteUtilityFnBlock(block: string): boolean {
  if (
    !/a\s+fun:function\s*;/i.test(block) ||
    !/fun:argumentNames/i.test(block) ||
    !/rdf:value\s*\[[\s\S]*?quan:sum\s*\(/i.test(block)
  ) {
    return false;
  }
  const mfCalls = extractMfCallBodies(block);
  if (mfCalls.length === 0) return false;
  return mfCalls.every((body) => isCompleteMfLogisticCall(body));
}

function isDraftUtilityFnBlock(block: string): boolean {
  return (
    /a\s+fun:Function\b/i.test(block) ||
    /fun:aggregates\b/i.test(block) ||
    /a\s+ut:Utility\b/i.test(block) ||
    /ut:hasUtilityProfile\b/i.test(block) ||
    /ut:hasFunction\b/i.test(block)
  );
}

function linkedUtilityFnLocal(block: string): string | null {
  const match = block.match(
    /ut:(?:function|hasFunction|utilityFunction)\s+data5g:((?:utilityFn_[A-Za-z0-9_]+|UN[0-9a-fA-F]{32}))/i,
  );
  return match?.[1] ?? null;
}

function linkedUtilityFnIsComplete(text: string, block: string): boolean {
  const utilityFnLocal = linkedUtilityFnLocal(block);
  if (!utilityFnLocal) return false;
  const utilityFnBlock = extractSubjectBlock(text, utilityFnLocal);
  if (!utilityFnBlock) return false;
  return isCompleteUtilityFnBlock(utilityFnBlock) && !isDraftUtilityFnBlock(utilityFnBlock);
}

function shouldStripUtilitySubject(local: string, block: string, text: string): boolean {
  if (local.startsWith("U_arg_")) return true;
  if (isCoordinationUtilityFunctionLocal(local)) {
    return !isCompleteUtilityFnBlock(block) || isDraftUtilityFnBlock(block);
  }
  if (isCoordinationUtilityInfoLocal(local)) {
    return (
      !/a\s+ut:UtilityInformation\b/i.test(block) ||
      isDraftUtilityFnBlock(block) ||
      !linkedUtilityFnIsComplete(text, block)
    );
  }
  if (isCoordinationUtilityProfileLocal(local)) {
    return (
      !/a\s+ut:UtilityProfile\b/i.test(block) ||
      /ut:hasFunction\b/i.test(block) ||
      /ut:utilityFunction\b/i.test(block)
    );
  }
  return false;
}

export function hasCoordinationExpectation(text: string): boolean {
  return /\bdata5g:CE[A-Za-z0-9_]+\s+a[\s\S]*?CoordinationExpectation/i.test(text);
}

const UNTYPED_MF_LOGISTIC_ARGS =
  /mf:(?:logistic|poly)\s*\(\s*data5g:U_arg_[A-Za-z0-9_-]+\s+(?!\"[^\"]*\"\^\^xsd:decimal)-?[0-9]/i;

export function ensureCoordinationUtilityLiteralTypes(text: string): string {
  let out = text;

  if (/mf:(?:logistic|poly)\s*\(/i.test(text)) {
    out = out.replace(
      /mf:(logistic|poly)\s*\(\s*(data5g:U_arg_[A-Za-z0-9_-]+)\s+(-?[0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)\s+("[^"]+"\^\^quan:quantity)\s*\)/g,
      'mf:$1 ( $2 "$3"^^xsd:decimal "$4"^^xsd:decimal $5 )',
    );
    out = out.replace(
      /data5g:standardK\s+(-?[0-9]+(?:\.[0-9]+)?)\s*;/g,
      'data5g:standardK "$1"^^xsd:decimal ;',
    );
    out = out.replace(
      /data5g:x0Fraction\s+(-?[0-9]+(?:\.[0-9]+)?)\s*;/g,
      'data5g:x0Fraction "$1"^^xsd:decimal ;',
    );
  }

  out = out.replace(
    /ut:minUtility\s+(-?[0-9]+(?:\.[0-9]+)?)\s*([;.])/g,
    'ut:minUtility "$1"^^xsd:decimal $2',
  );
  out = out.replace(
    /ut:maxUtility\s+(-?[0-9]+(?:\.[0-9]+)?)\s*([;.])/g,
    'ut:maxUtility "$1"^^xsd:decimal $2',
  );

  return out;
}

export function hasIncompleteCoordinationUtility(text: string): boolean {
  if (/ut:utility\s*\[/i.test(text) || /\but:UtilityFunction\b/i.test(text)) return true;
  if (UNTYPED_MF_LOGISTIC_ARGS.test(text)) return true;
  if (!/mf:(?:logistic|poly)\s*\(/i.test(text)) return false;
  const bodies = extractMfCallBodies(text);
  if (bodies.length === 0) return false;
  return bodies.some((body) => !isCompleteMfLogisticCall(body));
}

function resolveUserPrompt(context: {
  runtimeContext?: string;
  userPrompt?: string;
}): string {
  const explicit = context.userPrompt?.trim();
  if (explicit) return explicit;
  const userTextMatch = context.runtimeContext?.match(
    /User request:\s*([\s\S]*?)(?:\n\n|$)/i,
  );
  return userTextMatch?.[1]?.trim() ?? context.runtimeContext?.trim() ?? "";
}

/** Remove incomplete or wrong-namespace utility drafts the LLM sometimes emits mid-generation. */
export function stripDraftUtilityBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const local = subjectLocalFromLine(line);

    if (
      local &&
      (isCoordinationUtilityFunctionLocal(local) ||
        isCoordinationUtilityInfoLocal(local) ||
        isCoordinationUtilityProfileLocal(local) ||
        local.startsWith("U_arg_"))
    ) {
      const blockEnd = skipSubjectBlockLines(lines, i);
      const block = lines.slice(i, blockEnd).join("\n");
      if (shouldStripUtilitySubject(local, block, text)) {
        i = blockEnd - 1;
        continue;
      }
      out.push(...lines.slice(i, blockEnd));
      i = blockEnd - 1;
      continue;
    }

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function removeUtilityBlocks(text: string): string {
  let result = text;
  const locals = [
    ...result.matchAll(
      new RegExp(String.raw`\bdata5g:(${UTILITY_SUBJECT_LOCAL_PATTERN})\s+a\b`, "g"),
    ),
  ].map((match) => match[1]);
  for (const local of locals) {
    const block = extractSubjectBlock(result, local);
    if (!block) continue;
    result = result.replace(block, "");
  }
  return result.replace(/\n{3,}/g, "\n\n");
}

function insertCePredicates(ceBlock: string, predicates: string[]): string {
  if (predicates.length === 0) return ceBlock;
  const block = ceBlock.trimEnd().replace(/\s*\.\s*$/s, "");
  const tail = predicates.map((predicate) => `\n    ${predicate}`).join("");
  return `${block}${tail} .`;
}

function sanitizeCeUtilityLink(ceBlock: string, uInfoLocal: string): string {
  return ceBlock
    .replace(
      new RegExp(
        String.raw`\s*<http:\/\/tio\.models\.tmforum\.org\/tio\/v3\.6\.0\/UtilityFunctions\/utility>\s+data5g:${UTILITY_INFO_LINK_LOCAL_PATTERN}\s*[;.]?`,
        "gi",
      ),
      "",
    )
    .replace(/\s*ut:utility\s*\[[\s\S]*?\]\s*[;.]?/gi, "")
    .replace(new RegExp(String.raw`\s*ut:utility\s+data5g:${uInfoLocal}\s*[;.]?`, "gi"), "")
    .replace(/\s*ut:utility\s*;/gi, "")
    .replace(/;\s*;/g, ";");
}

function extractCeDescription(ceBlock: string): string | null {
  const match = ceBlock.match(/dct:description\s+"((?:\\.|[^"\\])*)"\s*[;.]?/i);
  return match?.[1]?.replace(/\\"/g, '"') ?? null;
}

function isCeContinuationLine(line: string, ceLocal: string): boolean {
  if (line.trim() === "") return true;
  if (isNewSubjectLine(line, ceLocal)) return false;
  return (
    /^\s+(?:data5g:coordinates|ut:utility|icm:|log:|dct:)/i.test(line) ||
    /^\s+<http:/i.test(line)
  );
}

function extractCoordinationExpectationRegion(text: string, ceLocal: string): string | null {
  const lines = text.split("\n");
  const subjectRe = new RegExp(String.raw`^\s*data5g:${ceLocal}\s+a\b`, "i");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (subjectRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = skipSubjectBlockLines(lines, start, ceLocal);
  while (end < lines.length && isCeContinuationLine(lines[end] ?? "", ceLocal)) {
    if ((lines[end] ?? "").trim() === "") {
      end += 1;
      continue;
    }
    if (lineEndsSubjectTerminator(lines[end] ?? "")) {
      end += 1;
      break;
    }
    end += 1;
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

function rebuildCoordinationExpectationBlock(
  ceLocal: string,
  ceBlock: string,
  conditions: ParsedCoordinationCondition[],
  coordinateLocals: string[],
  uInfoLocal: string,
): string {
  const refs = conditions.map((condition) => `data5g:${condition.local}`).join(", ");
  const coords = coordinateLocals.map((local) => `data5g:${local}`).join(",\n                       ");
  const description = extractCeDescription(ceBlock);
  const descriptionLine = description
    ? `    dct:description "${description.replace(/"/g, '\\"')}" ;\n`
    : "";
  return `data5g:${ceLocal} a data5g:CoordinationExpectation ;
${descriptionLine}    icm:target data5g:coordination-service ;
    log:allOf ${refs} ;
    ut:utility data5g:${uInfoLocal} ;
    data5g:coordinates ${coords} .`;
}

function sanitizeCeTarget(ceBlock: string): string {
  if (/icm:target\s+data5g:coordination-service/i.test(ceBlock)) return ceBlock;
  if (/icm:target\s+data5g:llm-service/i.test(ceBlock)) {
    return ceBlock.replace(/icm:target\s+data5g:llm-service/i, "icm:target data5g:coordination-service");
  }
  if (/icm:target/i.test(ceBlock)) return ceBlock;
  return ceBlock.replace(
    /(a\s+data5g:CoordinationExpectation\s*;)/i,
    "$1\n    icm:target data5g:coordination-service ;",
  );
}

function sanitizeCoordinationReportingTargets(text: string): { text: string; changes: number } {
  if (!hasCoordinationExpectation(text)) return { text, changes: 0 };

  const reLocals = [
    ...text.matchAll(/data5g:(RE[A-Za-z0-9_]+)\s+a\s+icm:ObservationReportingExpectation/gi),
  ].map((match) => match[1]);

  let changes = 0;
  for (const local of reLocals) {
    const block = extractSubjectBlock(text, local);
    if (!block || !/icm:target\s+data5g:llm-service/i.test(block)) continue;
    const fixed = block.replace(
      /icm:target\s+data5g:llm-service/i,
      "icm:target data5g:coordination-service",
    );
    if (fixed === block) continue;
    text = text.replace(block, fixed);
    changes += 1;
  }

  return { text, changes };
}

function hasCoordinationReportingExpectation(text: string): boolean {
  for (const match of text.matchAll(
    /data5g:(RE[A-Za-z0-9_]+)\s+a\s+icm:ObservationReportingExpectation/gi,
  )) {
    const block = extractSubjectBlock(text, match[1]);
    if (block && /icm:target\s+data5g:coordination-service/i.test(block)) return true;
  }
  return false;
}

function detectReportStorage(text: string): "prometheus" | "graphdb" {
  return /data5g:prometheus/.test(text) ? "prometheus" : "graphdb";
}

function ensureCoordinationReportingBlock(
  text: string,
  ceLocal: string,
): { text: string; changes: number } {
  if (hasCoordinationReportingExpectation(text)) return { text, changes: 0 };
  const storage = detectReportStorage(text);
  const reLocal = ceLocal.startsWith("CE") ? `RE${ceLocal.slice(2)}` : `RE_${ceLocal}`;
  const eventLocal = `TenMinuteReportEventCoordination_${ceLocal}`;
  const durationLocal = `durationCoordination_${ceLocal}`;
  const insert = `data5g:${durationLocal} a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:${eventLocal} a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:${durationLocal} ) ;
    imo:eventFor data5g:${ceLocal} .

data5g:${reLocal} a icm:ObservationReportingExpectation ;
    dct:description "Coordination observation reports." ;
    icm:target data5g:coordination-service ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:${storage} ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:${eventLocal} ] .`;
  return { text: `${text.trimEnd()}\n\n${insert}`, changes: 1 };
}

function upsertCoordinates(ceBlock: string, coordinateLocals: string[], uInfoLocal: string): string {
  const coords = coordinateLocals.map((l) => `data5g:${l}`).join(",\n                       ");
  if (!coords) return ceBlock;
  if (/data5g:coordinates/i.test(ceBlock)) {
    return ceBlock.replace(
      /data5g:coordinates[\s\S]*?;/i,
      `data5g:coordinates ${coords} ;`,
    );
  }
  if (new RegExp(String.raw`ut:utility\s+data5g:${uInfoLocal}`, "i").test(ceBlock)) {
    return ceBlock.replace(
      new RegExp(String.raw`(ut:utility\s+data5g:${uInfoLocal}\s*;)`, "i"),
      `$1\n    data5g:coordinates ${coords} ;`,
    );
  }
  return insertCePredicates(ceBlock, [`data5g:coordinates ${coords} ;`]);
}

function upsertCeLogAllOf(ceBlock: string, conditionLocals: string[]): string {
  if (conditionLocals.length === 0) return ceBlock;
  const refs = conditionLocals.map((local) => `data5g:${local}`).join(", ");
  if (/log:allOf/i.test(ceBlock)) {
    const replaced = ceBlock.replace(/log:allOf\s+([^.;]+)[.;]/is, `log:allOf ${refs} ;`);
    if (replaced !== ceBlock) return replaced;
  }
  return insertCePredicates(ceBlock, [`log:allOf ${refs} ;`]);
}

function upsertUtilityLink(ceBlock: string, uInfoLocal: string): string {
  const block = sanitizeCeUtilityLink(ceBlock, uInfoLocal);
  if (new RegExp(String.raw`ut:utility\s+data5g:${uInfoLocal}\s*;`, "i").test(block)) return block;
  if (/log:allOf[^;]*;/is.test(block)) {
    return block.replace(/(log:allOf[^;]*;)/is, `$1\n    ut:utility data5g:${uInfoLocal} ;`);
  }
  return insertCePredicates(block, [`ut:utility data5g:${uInfoLocal} ;`]);
}

export function normalizeCoordinationUtility(args: {
  text: string;
  flags: CoordinationDeriveFlags;
  userText?: string;
}): { text: string; changes: number; note?: string } {
  let text = stripDraftUtilityBlocks(stripMisalignedUtilityTurtle(args.text));

  const ceLocal = findCoordinationExpectationLocal(text);
  if (!ceLocal) {
    return { text, changes: text === args.text ? 0 : 1 };
  }

  const utilityLocals = resolveCoordinationUtilityLocals(text);

  const reTargetSanitized = sanitizeCoordinationReportingTargets(text);
  text = reTargetSanitized.text;
  let changes = text === args.text ? 0 : 1;
  if (reTargetSanitized.changes > 0) changes = Math.max(changes, 1);

  let ceBlock = extractSubjectBlock(text, ceLocal);
  if (!ceBlock) {
    return { text, changes };
  }

  const oldCeConditionLocals = extractLocalsFromAllOf(ceBlock).filter((local) =>
    local.startsWith("CO"),
  );
  const parsedFromCe: ParsedCoordinationCondition[] = [];
  for (const local of oldCeConditionLocals) {
    const parsed = resolveConditionForCoordination(text, local);
    if (parsed) parsedFromCe.push(parsed);
  }
  const conditions = canonicalizeCoordinationConditions(
    text,
    parsedFromCe,
    args.userText ?? "",
  );
  const keptConditionLocals = new Set(conditions.map((condition) => condition.local));
  const orphanCeLocals = oldCeConditionLocals.filter(
    (local) =>
      !keptConditionLocals.has(local) && !isExpectationOwnedCondition(text, local),
  );
  if (orphanCeLocals.length > 0) {
    text = removeOrphanCoordinationArtifacts(text, orphanCeLocals);
    changes = Math.max(changes, 1);
    ceBlock = extractSubjectBlock(text, ceLocal) ?? ceBlock;
  }
  if (conditions.length === 0) {
    text = removeUtilityBlocks(text);
    if (ceLocal) {
      let strippedCe = extractSubjectBlock(text, ceLocal);
      if (strippedCe) {
        strippedCe = sanitizeCeUtilityLink(strippedCe, utilityLocals.uInfo);
        text = text.replace(extractSubjectBlock(text, ceLocal) ?? "", strippedCe);
      }
    }
    return {
      text,
      changes: Math.max(changes, text === args.text ? 0 : 1),
      note: "coordinationUtility: no parseable CE conditions; removed malformed utility blocks",
    };
  }

  const specs = buildSubUtilitySpecs(conditions, args.flags, args.userText ?? "");
  const profileSuffix =
    args.flags.coordinationWeighted && !args.flags.coordinationSymmetric
      ? "weighted"
      : args.flags.coordinationSymmetric && !args.flags.coordinationWeighted
        ? "symmetric"
        : args.flags.coordinationWeighted
          ? "weighted"
          : "symmetric";
  const utilityFnLocal = utilityLocals.utilityFnLocal(profileSuffix);

  const coordinateLocals = resolveCoordinateLocals(args.text, conditions);

  ceBlock = rebuildCoordinationExpectationBlock(
    ceLocal,
    ceBlock,
    conditions,
    coordinateLocals,
    utilityLocals.uInfo,
  );

  const currentCeRegion = extractCoordinationExpectationRegion(text, ceLocal);
  if (currentCeRegion) {
    text = text.replace(currentCeRegion, ceBlock);
    changes = Math.max(changes, 1);
  }

  const utilityInfo = buildUtilityInformationBlock(
    specs,
    conditions,
    utilityFnLocal,
    utilityLocals,
  );
  const utilityFn = buildUtilityFunctionBlock(utilityFnLocal, specs, conditions);
  text = removeUtilityBlocks(text);
  text = `${text.trimEnd()}\n\n${utilityInfo}\n\n${utilityFn}\n`;

  const reportingInserted = ensureCoordinationReportingBlock(text, ceLocal);
  if (reportingInserted.changes > 0) {
    text = reportingInserted.text;
    changes = Math.max(changes, 1);
  }

  const typedText = ensureCoordinationUtilityLiteralTypes(text);
  return {
    text: typedText,
    changes: Math.max(changes, 1),
    note: `coordinationUtility: normalized ${conditions.length} sub-utilities (${profileSuffix})`,
  };
}

function deriveCoordinationFlags(
  intentFlags: Record<string, boolean>,
  userText: string,
): CoordinationDeriveFlags {
  const lowered = userText.toLowerCase();
  return {
    coordinationSymmetric:
      intentFlags.coordinationSymmetric ||
      /symmetric coordination|symetric coordination|equal weight/.test(lowered),
    coordinationWeighted:
      intentFlags.coordinationWeighted ||
      /weighted coordination|unequal weight|prioritize/.test(lowered),
    coordinationSeverityCritical:
      intentFlags.coordinationSeverityCritical ||
      /\b(critical|critic|strict)\b/.test(lowered),
    coordinationSeverityTrivial:
      intentFlags.coordinationSeverityTrivial ||
      /\b(trivial|lenient|relaxed)\b/.test(lowered),
  };
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    intentFlags?: Record<string, boolean>;
    runtimeContext?: string;
    userPrompt?: string;
  };
}): { text: string; changes: number; note?: string } {
  const flags = args.context.intentFlags ?? {};
  const hasCe = hasCoordinationExpectation(args.text);
  const hasMalformedUtility = hasIncompleteCoordinationUtility(args.text);
  if (!flags.coordination && !hasCe && !hasMalformedUtility) {
    return { text: args.text, changes: 0 };
  }

  const userText = resolveUserPrompt(args.context);

  const result = normalizeCoordinationUtility({
    text: args.text,
    flags: deriveCoordinationFlags(flags, userText),
    userText,
  });
  const typedText = ensureCoordinationUtilityLiteralTypes(result.text);
  if (typedText === result.text) {
    return result;
  }
  return {
    text: typedText,
    changes: Math.max(result.changes, 1),
    note: result.note ?? "coordinationUtility: typed mf:logistic decimal literals",
  };
}

export function parseCoordinationConditionsFromText(text: string): ParsedCoordinationCondition[] {
  const ceLocal = findCoordinationExpectationLocal(text);
  if (!ceLocal) return [];
  const ceBlock = extractSubjectBlock(text, ceLocal);
  if (!ceBlock) return [];
  const conditionLocals = extractLocalsFromAllOf(ceBlock).filter((l) => l.startsWith("CO"));
  const conditions: ParsedCoordinationCondition[] = [];
  for (const local of conditionLocals) {
    const parsed = resolveConditionForCoordination(text, local);
    if (parsed) conditions.push(parsed);
  }
  return conditions;
}
