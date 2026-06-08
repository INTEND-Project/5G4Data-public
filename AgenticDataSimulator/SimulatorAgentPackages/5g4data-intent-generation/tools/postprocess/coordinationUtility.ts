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
  const end = skipSubjectBlockLines(lines, start);
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
    if (ceConditionLocals.has(local)) continue;
    const block = extractSubjectBlock(text, local);
    if (!block) continue;
    const parsed = parseConditionBlock(block, local);
    if (parsed) conditions.push(parsed);
  }
  return conditions;
}

function hasMetricCategory(
  conditions: ParsedCoordinationCondition[],
  category: ReturnType<typeof coordinationMetricCategory>,
): boolean {
  return conditions.some((condition) => coordinationMetricCategory(condition.metricStem) === category);
}

function pickExpectationCondition(
  expectationConditions: ParsedCoordinationCondition[],
  category: ReturnType<typeof coordinationMetricCategory>,
  userText: string,
): ParsedCoordinationCondition | undefined {
  const candidates = expectationConditions.filter(
    (condition) => coordinationMetricCategory(condition.metricStem) === category,
  );
  if (candidates.length === 0) return undefined;

  const active = candidates.filter(
    (condition) => !isDeprecatedSustainabilityMetricStem(condition.metricStem),
  );
  const pool = active.length > 0 ? active : candidates;
  const lowered = userText.toLowerCase();

  if (category === "energy") {
    if (/energy consumption|energy-consumption/.test(lowered)) {
      return pool.find((condition) => condition.metricStem === "energy-consumption") ?? pool[0];
    }
    if (/power consumption|power-consumption/.test(lowered)) {
      return pool.find((condition) => condition.metricStem === "power-consumption") ?? pool[0];
    }
    return pool.find((condition) => condition.metricStem === "energy-consumption") ?? pool[0];
  }

  if (category === "throughput") {
    return pool.find((condition) => coordinationMetricCategory(condition.metricStem) === "throughput") ?? pool[0];
  }

  return pool[0];
}

function inferMissingCoordinationConditions(
  text: string,
  userText: string,
  conditions: ParsedCoordinationCondition[],
): ParsedCoordinationCondition[] {
  const merged = [...conditions];
  const lowered = userText.toLowerCase();
  const wantsThroughput = /throughput|token|\btps\b|p99/.test(lowered);
  const wantsEnergy = /energy|joule|watt|power|consumption|sustain/.test(lowered);
  const expectationConditions = collectExpectationConditions(text);

  const addFromExpectations = (category: ReturnType<typeof coordinationMetricCategory>) => {
    if (hasMetricCategory(merged, category)) return;
    const candidate = pickExpectationCondition(expectationConditions, category, userText);
    if (candidate) merged.push(candidate);
  };

  if (wantsThroughput) addFromExpectations("throughput");
  if (wantsEnergy) addFromExpectations("energy");

  if (wantsThroughput && wantsEnergy) {
    addFromExpectations("throughput");
    addFromExpectations("energy");
  }

  return merged;
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
): string {
  const argNames = specs.map((s) => `data5g:${s.argLocal}`).join(" ");
  const forMetricLines = specs
    .map(
      (spec, index) =>
        `    ut:forMetric      ( data5g:${spec.argLocal}    ${conditions[index].metricLocal} ) ;`,
    )
    .join("\n");
  return `data5g:U_coord
    a ut:UtilityInformation ;
    ut:function       data5g:${utilityFnLocal} ;
    ut:withArguments  ( ${argNames} ) ;
${forMetricLines}
    ut:utilityProfile data5g:UP_coord .

data5g:UP_coord a ut:UtilityProfile ;
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
function skipSubjectBlockLines(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && !lines[i].trimEnd().endsWith(".")) {
    i += 1;
  }
  return i < lines.length ? i + 1 : i;
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

    if (local === "U_coord" || local === "UP_coord") {
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
    String.raw`\s*<${UTILITY_FUNCTIONS_NS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}utility>\s+data5g:U_coord\s*[;.]`,
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
  const match = block.match(/ut:(?:function|hasFunction|utilityFunction)\s+data5g:(utilityFn_[A-Za-z0-9_]+)/i);
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
  if (local.startsWith("utilityFn_")) {
    return !isCompleteUtilityFnBlock(block) || isDraftUtilityFnBlock(block);
  }
  if (local === "U_coord") {
    return (
      !/a\s+ut:UtilityInformation\b/i.test(block) ||
      isDraftUtilityFnBlock(block) ||
      !linkedUtilityFnIsComplete(text, block)
    );
  }
  if (local === "UP_coord") {
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
      (local.startsWith("utilityFn_") ||
        local === "U_coord" ||
        local === "UP_coord" ||
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

function isUtilitySubjectLocal(local: string): boolean {
  return (
    local === "U_coord" ||
    local === "UP_coord" ||
    local.startsWith("utilityFn_") ||
    local.startsWith("U_arg_")
  );
}

function removeUtilityBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const local = subjectLocalFromLine(lines[i]);
    if (local && isUtilitySubjectLocal(local)) {
      i = skipSubjectBlockLines(lines, i) - 1;
      continue;
    }
    out.push(lines[i]);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function insertCePredicates(ceBlock: string, predicates: string[]): string {
  if (predicates.length === 0) return ceBlock;
  const block = ceBlock.trimEnd().replace(/\s*\.\s*$/s, "");
  const tail = predicates.map((predicate) => `\n    ${predicate}`).join("");
  return `${block}${tail} .`;
}

function sanitizeCeUtilityLink(ceBlock: string): string {
  return ceBlock
    .replace(
      /\s*<http:\/\/tio\.models\.tmforum\.org\/tio\/v3\.6\.0\/UtilityFunctions\/utility>\s+data5g:U_coord\s*[;.]/gi,
      "",
    )
    .replace(/\s*ut:utility\s*\[[\s\S]*?\]\s*/gi, "")
    .replace(/\s*ut:utility\s+data5g:U_coord\s*;/gi, "");
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

function upsertCoordinates(ceBlock: string, coordinateLocals: string[]): string {
  const coords = coordinateLocals.map((l) => `data5g:${l}`).join(",\n                       ");
  if (!coords) return ceBlock;
  if (/data5g:coordinates/i.test(ceBlock)) {
    return ceBlock.replace(
      /data5g:coordinates[\s\S]*?;/i,
      `data5g:coordinates ${coords} ;`,
    );
  }
  if (/ut:utility\s+data5g:U_coord/i.test(ceBlock)) {
    return ceBlock.replace(
      /(ut:utility\s+data5g:U_coord\s*;)/i,
      `$1\n    data5g:coordinates ${coords} ;`,
    );
  }
  return insertCePredicates(ceBlock, [`data5g:coordinates ${coords} ;`]);
}

function upsertCeLogAllOf(ceBlock: string, conditionLocals: string[]): string {
  if (conditionLocals.length === 0) return ceBlock;
  const refs = conditionLocals.map((local) => `data5g:${local}`).join(", ");
  if (/log:allOf/i.test(ceBlock)) {
    return ceBlock.replace(/log:allOf\s+([^;]+);/is, `log:allOf ${refs} ;`);
  }
  return insertCePredicates(ceBlock, [`log:allOf ${refs} ;`]);
}

function upsertUtilityLink(ceBlock: string): string {
  if (/ut:utility\s+data5g:U_coord/i.test(ceBlock)) return ceBlock;
  if (/log:allOf[^;]*;/is.test(ceBlock)) {
    return ceBlock.replace(/(log:allOf[^;]*;)/is, `$1\n    ut:utility data5g:U_coord ;`);
  }
  return insertCePredicates(ceBlock, ["ut:utility data5g:U_coord ;"]);
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

  const reTargetSanitized = sanitizeCoordinationReportingTargets(text);
  text = reTargetSanitized.text;
  let changes = text === args.text ? 0 : 1;
  if (reTargetSanitized.changes > 0) changes = Math.max(changes, 1);

  let ceBlock = extractSubjectBlock(text, ceLocal);
  if (!ceBlock) {
    return { text, changes };
  }

  const conditionLocals = extractLocalsFromAllOf(ceBlock).filter((l) => l.startsWith("CO"));
  let conditions: ParsedCoordinationCondition[] = [];
  for (const local of conditionLocals) {
    const parsed = resolveConditionForCoordination(text, local);
    if (parsed) conditions.push(parsed);
  }
  conditions = inferMissingCoordinationConditions(text, args.userText ?? "", conditions);
  if (conditions.length === 0) {
    text = removeUtilityBlocks(text);
    if (ceLocal) {
      let strippedCe = extractSubjectBlock(text, ceLocal);
      if (strippedCe) {
        strippedCe = sanitizeCeUtilityLink(strippedCe);
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
  const utilityFnLocal = `utilityFn_${profileSuffix}`;

  const coordinateLocals = resolveCoordinateLocals(args.text, conditions);

  ceBlock = sanitizeCeUtilityLink(ceBlock);
  ceBlock = sanitizeCeTarget(ceBlock);
  ceBlock = upsertCeLogAllOf(
    ceBlock,
    conditions.map((condition) => condition.local),
  );
  ceBlock = upsertUtilityLink(ceBlock);
  ceBlock = upsertCoordinates(ceBlock, coordinateLocals);

  text = text.replace(extractSubjectBlock(text, ceLocal) ?? "", ceBlock);

  const utilityInfo = buildUtilityInformationBlock(specs, conditions, utilityFnLocal);
  const utilityFn = buildUtilityFunctionBlock(utilityFnLocal, specs, conditions);
  text = removeUtilityBlocks(text);
  text = `${text.trimEnd()}\n\n${utilityInfo}\n\n${utilityFn}\n`;

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
