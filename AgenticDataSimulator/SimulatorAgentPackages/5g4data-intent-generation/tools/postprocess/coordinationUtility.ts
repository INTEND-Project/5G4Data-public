import {
  argLocalFromMetricStem,
  buildSubUtilitySpecs,
  expectationPrefixForMetricStem,
  metricStemFromScopedLocal,
  type CoordinationDeriveFlags,
  type ParsedCoordinationCondition,
  type SubUtilitySpec,
  formatDecimal,
} from "./coordinationUtilityDerive.js";

function extractSubjectBlock(text: string, local: string): string | null {
  const start = text.search(new RegExp(String.raw`\bdata5g:${local}\s+a\b`, "i"));
  if (start < 0) return null;
  const tail = text.slice(start);
  const nextSubject = tail.slice(1).search(/\n\s*data5g:/);
  const end = nextSubject >= 0 ? start + 1 + nextSubject : text.length;
  return text.slice(start, end);
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

function isCompleteUtilityFnBlock(block: string): boolean {
  return (
    /a\s+fun:function\s*;/i.test(block) &&
    /fun:argumentNames/i.test(block) &&
    /rdf:value\s*\[\s*quan:sum\s*\([\s\S]*\)\s*\]\s*\./i.test(block)
  );
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

function shouldStripUtilitySubject(local: string, block: string): boolean {
  if (local.startsWith("U_arg_")) return true;
  if (local.startsWith("utilityFn_")) {
    return !isCompleteUtilityFnBlock(block) || isDraftUtilityFnBlock(block);
  }
  if (local === "U_coord") {
    return !/a\s+ut:UtilityInformation\b/i.test(block) || isDraftUtilityFnBlock(block);
  }
  if (local === "UP_coord") {
    return !/a\s+ut:UtilityProfile\b/i.test(block) || /ut:hasFunction\b/i.test(block);
  }
  return false;
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
      if (shouldStripUtilitySubject(local, block)) {
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
  return text
    .replace(/\n?data5g:U_coord[\s\S]*?ut:utilityProfile data5g:UP_coord \.\s*/gi, "\n")
    .replace(/\n?data5g:UP_coord a ut:UtilityProfile ;[\s\S]*?ut:maxUtility "1\.0"\^\^xsd:decimal \.\s*/gi, "\n")
    .replace(/\n?data5g:utilityFn_[A-Za-z0-9_]+ a fun:function ;[\s\S]*?\) \] \.\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function sanitizeCeUtilityLink(ceBlock: string): string {
  return ceBlock
    .replace(
      /\s*<http:\/\/tio\.models\.tmforum\.org\/tio\/v3\.6\.0\/UtilityFunctions\/utility>\s+data5g:U_coord\s*[;.]/gi,
      "",
    )
    .replace(/\s*ut:utility\s+data5g:U_coord\s*;/gi, "");
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
  const insert = `\n    data5g:coordinates ${coords} ;`;
  return ceBlock.replace(/\s\.\s*$/s, `${insert} .`);
}

function upsertUtilityLink(ceBlock: string): string {
  if (/ut:utility\s+data5g:U_coord/i.test(ceBlock)) return ceBlock;
  if (/log:allOf[^;]*;/is.test(ceBlock)) {
    return ceBlock.replace(/(log:allOf[^;]*;)/is, `$1\n    ut:utility data5g:U_coord ;`);
  }
  const insert = `\n    ut:utility data5g:U_coord ;`;
  return ceBlock.replace(/\s\.\s*$/s, `${insert} .`);
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

  let ceBlock = extractSubjectBlock(text, ceLocal);
  if (!ceBlock) {
    return { text, changes: text === args.text ? 0 : 1 };
  }

  const conditionLocals = extractLocalsFromAllOf(ceBlock).filter((l) => l.startsWith("CO"));
  const conditions: ParsedCoordinationCondition[] = [];
  for (const local of conditionLocals) {
    const block = extractSubjectBlock(args.text, local);
    if (!block) continue;
    const parsed = parseConditionBlock(block, local);
    if (parsed) conditions.push(parsed);
  }
  if (conditions.length === 0) {
    return {
      text,
      changes: text === args.text ? 0 : 1,
      note: "coordinationUtility: no parseable CE conditions",
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
  ceBlock = upsertUtilityLink(ceBlock);
  ceBlock = upsertCoordinates(ceBlock, coordinateLocals);

  text = text.replace(extractSubjectBlock(text, ceLocal) ?? "", ceBlock);

  const utilityInfo = buildUtilityInformationBlock(specs, conditions, utilityFnLocal);
  const utilityFn = buildUtilityFunctionBlock(utilityFnLocal, specs, conditions);
  text = removeUtilityBlocks(text);
  text = `${text.trimEnd()}\n\n${utilityInfo}\n\n${utilityFn}\n`;

  return {
    text,
    changes: 1,
    note: `coordinationUtility: normalized ${conditions.length} sub-utilities (${profileSuffix})`,
  };
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    intentFlags?: Record<string, boolean>;
    runtimeContext?: string;
  };
}): { text: string; changes: number; note?: string } {
  const flags = args.context.intentFlags ?? {};
  if (!flags.coordination) {
    return { text: args.text, changes: 0 };
  }

  const userTextMatch = args.context.runtimeContext?.match(
    /User request:\s*([\s\S]*?)(?:\n\n|$)/i,
  );
  const userText = userTextMatch?.[1]?.trim() ?? args.context.runtimeContext ?? "";

  return normalizeCoordinationUtility({
    text: args.text,
    flags: {
      coordinationSymmetric: flags.coordinationSymmetric,
      coordinationWeighted: flags.coordinationWeighted,
      coordinationSeverityCritical: flags.coordinationSeverityCritical,
      coordinationSeverityTrivial: flags.coordinationSeverityTrivial,
    },
    userText,
  });
}

export function parseCoordinationConditionsFromText(text: string): ParsedCoordinationCondition[] {
  const ceLocal = findCoordinationExpectationLocal(text);
  if (!ceLocal) return [];
  const ceBlock = extractSubjectBlock(text, ceLocal);
  if (!ceBlock) return [];
  const conditionLocals = extractLocalsFromAllOf(ceBlock).filter((l) => l.startsWith("CO"));
  const conditions: ParsedCoordinationCondition[] = [];
  for (const local of conditionLocals) {
    const block = extractSubjectBlock(text, local);
    if (!block) continue;
    const parsed = parseConditionBlock(block, local);
    if (parsed) conditions.push(parsed);
  }
  return conditions;
}
