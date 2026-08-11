import { ensureCoordinationUtilityLiteralTypes } from "./postprocess/coordinationUtility.js";
import { Parser, Writer, type BlankNode, type BlankTriple, type Quad } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";
const LOG_ALLOF = "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/allOf";
const ICM_INTENT = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/Intent";
const ICM_CONDITION = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/Condition";
const ICM_CONTEXT = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/Context";
const IMO_EVENT_FOR = "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/eventFor";
const TIME_DELAY = "http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/delay";

/** Preferred Turtle prefixes (aligned with intent-generation examples). */
const INTENT_TURTLE_PREFIXES: Record<string, string> = {
  data5g: "http://5g4data.eu/5g4data#",
  dct: "http://purl.org/dc/terms/",
  geo: "http://www.opengis.net/ont/geosparql#",
  icm: "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/",
  imo: "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/",
  log: "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/",
  mf: "http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/",
  fun: "http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/",
  set: "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/",
  quan: "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  time: "http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/",
  ut: "http://tio.models.tmforum.org/tio/v3.6.0/Utility/",
  uf: "http://tio.models.tmforum.org/tio/v3.6.0/UtilityFunctions/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

const PREFERRED_PREFIX_ORDER = [
  "data5g",
  "dct",
  "geo",
  "icm",
  "imo",
  "log",
  "mf",
  "fun",
  "set",
  "quan",
  "rdf",
  "rdfs",
  "time",
  "ut",
  "uf",
  "xsd",
] as const;

/** GraphDB / parser noise — never re-emit these as @prefix lines. */
const BLOCKED_EXTRACTED_PREFIXES = new Set(["rdf4j", "sesame", "owl", "fn", "ns1"]);

function isBlankNode(term: Quad["subject"] | Quad["object"]): term is BlankNode {
  return term.termType === "BlankNode";
}

function extractPrefixesFromTurtle(raw: string): Record<string, string> {
  const prefixes: Record<string, string> = {};
  const pattern = /@prefix\s+([\w-]+):\s+<([^>]+)>\s*\./gi;
  let match = pattern.exec(raw);
  while (match) {
    prefixes[match[1]] = match[2];
    match = pattern.exec(raw);
  }
  return prefixes;
}

function mergePrefixes(raw: string): Record<string, string> {
  const merged = { ...INTENT_TURTLE_PREFIXES };
  for (const [prefix, iri] of Object.entries(extractPrefixesFromTurtle(raw))) {
    if (BLOCKED_EXTRACTED_PREFIXES.has(prefix) || prefix in INTENT_TURTLE_PREFIXES) {
      continue;
    }
    merged[prefix] = iri;
  }
  return merged;
}

function markPrefixUse(
  value: string,
  prefixes: Record<string, string>,
  used: Set<string>,
): void {
  for (const [prefix, iri] of Object.entries(prefixes)) {
    if (value.startsWith(iri)) {
      used.add(prefix);
      return;
    }
  }
}

function selectPrefixesForQuads(
  quads: Quad[],
  availablePrefixes: Record<string, string>,
): Record<string, string> {
  const used = new Set<string>();

  for (const quad of quads) {
    if (quad.subject.termType === "NamedNode") {
      markPrefixUse(quad.subject.value, availablePrefixes, used);
    }
    if (quad.predicate.termType === "NamedNode") {
      markPrefixUse(quad.predicate.value, availablePrefixes, used);
    }
    if (quad.object.termType === "NamedNode") {
      markPrefixUse(quad.object.value, availablePrefixes, used);
    }
    if (quad.object.termType === "Literal" && quad.object.datatype?.termType === "NamedNode") {
      markPrefixUse(quad.object.datatype.value, availablePrefixes, used);
    }
  }

  const selected: Record<string, string> = {};
  for (const prefix of PREFERRED_PREFIX_ORDER) {
    if (used.has(prefix) && availablePrefixes[prefix]) {
      selected[prefix] = availablePrefixes[prefix];
    }
  }
  for (const prefix of Object.keys(availablePrefixes).sort()) {
    if (used.has(prefix) && !(prefix in selected)) {
      selected[prefix] = availablePrefixes[prefix];
    }
  }
  return selected;
}

function blankObjectRefCounts(quads: Quad[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const quad of quads) {
    if (!isBlankNode(quad.object)) {
      continue;
    }
    const key = quad.object.value;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function quadsBySubject(quads: Quad[]): Map<string, Quad[]> {
  const map = new Map<string, Quad[]>();
  for (const quad of quads) {
    const key = quad.subject.value;
    const existing = map.get(key);
    if (existing) {
      existing.push(quad);
    } else {
      map.set(key, [quad]);
    }
  }
  return map;
}

function predicateSortKey(predicate: Quad["predicate"]): string {
  if (predicate.value === RDF_TYPE) {
    return "\u0000";
  }
  return predicate.value;
}

function sortQuadsForSubject(quads: Quad[]): Quad[] {
  return [...quads].sort((left, right) => {
    const predicateOrder = predicateSortKey(left.predicate).localeCompare(
      predicateSortKey(right.predicate),
    );
    if (predicateOrder !== 0) {
      return predicateOrder;
    }
    return left.object.value.localeCompare(right.object.value);
  });
}

function tryExtractRdfList(
  head: BlankNode,
  bySubject: Map<string, Quad[]>,
): Quad["object"][] | null {
  const items: Quad["object"][] = [];
  let current: Quad["object"] | null = head;

  while (current && isBlankNode(current)) {
    const propertyQuads = bySubject.get(current.value);
    if (!propertyQuads?.length) {
      return null;
    }

    const firstQuad = propertyQuads.find((quad) => quad.predicate.value === RDF_FIRST);
    const restQuad = propertyQuads.find((quad) => quad.predicate.value === RDF_REST);
    if (!firstQuad || !restQuad) {
      return null;
    }

    items.push(firstQuad.object);

    if (restQuad.object.value === RDF_NIL) {
      return items;
    }
    if (!isBlankNode(restQuad.object)) {
      return null;
    }
    current = restQuad.object;
  }

  return null;
}

function encodeObject(
  writer: Writer,
  object: Quad["object"],
  refCounts: Map<string, number>,
  bySubject: Map<string, Quad[]>,
): Quad["object"] {
  if (isBlankNode(object) && (refCounts.get(object.value) ?? 0) === 1) {
    const listItems = tryExtractRdfList(object, bySubject);
    if (listItems?.length) {
      return writer.list(
        listItems.map((item) => encodeObject(writer, item, refCounts, bySubject)),
      ) as unknown as Quad["object"];
    }
  }

  if (!isBlankNode(object) || (refCounts.get(object.value) ?? 0) !== 1) {
    return object;
  }

  const propertyQuads = bySubject.get(object.value);
  if (!propertyQuads?.length) {
    return object;
  }

  const children: BlankTriple[] = sortQuadsForSubject(propertyQuads).map((quad) => ({
    predicate: quad.predicate,
    object: encodeObject(writer, quad.object, refCounts, bySubject) as Quad["object"],
  }));

  return writer.blank(children) as Quad["object"];
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const separator = Math.max(hash, slash);
  return separator >= 0 ? iri.slice(separator + 1) : iri;
}

function subjectTypeValues(bySubject: Map<string, Quad[]>, subjectValue: string): string[] {
  return (bySubject.get(subjectValue) ?? [])
    .filter((quad) => quad.predicate.value === RDF_TYPE)
    .map((quad) => quad.object.value);
}

function hasSubjectType(
  bySubject: Map<string, Quad[]>,
  subjectValue: string,
  typeIri: string,
): boolean {
  return subjectTypeValues(bySubject, subjectValue).includes(typeIri);
}

function isIntentSubject(bySubject: Map<string, Quad[]>, subjectValue: string): boolean {
  if (hasSubjectType(bySubject, subjectValue, ICM_INTENT)) {
    return true;
  }
  return /^I[a-f0-9]{32}$/i.test(localName(subjectValue));
}

function isConditionSubject(bySubject: Map<string, Quad[]>, subjectValue: string): boolean {
  if (hasSubjectType(bySubject, subjectValue, ICM_CONDITION)) {
    return true;
  }
  return localName(subjectValue).startsWith("CO");
}

function isContextSubject(bySubject: Map<string, Quad[]>, subjectValue: string): boolean {
  if (hasSubjectType(bySubject, subjectValue, ICM_CONTEXT)) {
    return true;
  }
  return localName(subjectValue).startsWith("CX");
}

function logAllOfObjectValues(bySubject: Map<string, Quad[]>, subjectValue: string): string[] {
  return (bySubject.get(subjectValue) ?? [])
    .filter((quad) => quad.predicate.value === LOG_ALLOF && quad.object.termType === "NamedNode")
    .map((quad) => quad.object.value);
}

function collectDelayListItems(
  bySubject: Map<string, Quad[]>,
  subjectValue: string,
): string[] {
  for (const quad of bySubject.get(subjectValue) ?? []) {
    if (quad.predicate.value !== TIME_DELAY || !isBlankNode(quad.object)) {
      continue;
    }
    const listItems = tryExtractRdfList(quad.object, bySubject);
    if (listItems?.length) {
      return listItems
        .filter((item) => item.termType === "NamedNode")
        .map((item) => item.value);
    }
  }
  return [];
}

function appendExpectationSatellites(
  bySubject: Map<string, Quad[]>,
  expectationValue: string,
  addSubject: (subjectValue: string) => void,
): void {
  for (const [subjectValue, quads] of bySubject) {
    if (quads.some((quad) => quad.predicate.value === IMO_EVENT_FOR && quad.object.value === expectationValue)) {
      addSubject(subjectValue);
      for (const related of collectDelayListItems(bySubject, subjectValue)) {
        addSubject(related);
      }
    }
  }
}

function buildIntentSubjectOrder(
  bySubject: Map<string, Quad[]>,
  subjectValues: string[],
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const addSubject = (subjectValue: string) => {
    if (seen.has(subjectValue) || !bySubject.has(subjectValue)) {
      return;
    }
    seen.add(subjectValue);
    ordered.push(subjectValue);
  };

  const intents = subjectValues
    .filter((value) => isIntentSubject(bySubject, value))
    .sort((left, right) => left.localeCompare(right));

  for (const intentValue of intents) {
    addSubject(intentValue);
  }

  for (const intentValue of intents) {
    for (const expectationValue of logAllOfObjectValues(bySubject, intentValue)) {
      addSubject(expectationValue);

      const children = logAllOfObjectValues(bySubject, expectationValue);
      for (const childValue of children) {
        if (isConditionSubject(bySubject, childValue)) {
          addSubject(childValue);
        }
      }
      for (const childValue of children) {
        if (isContextSubject(bySubject, childValue)) {
          addSubject(childValue);
        }
      }
      for (const childValue of children) {
        if (
          !isConditionSubject(bySubject, childValue) &&
          !isContextSubject(bySubject, childValue)
        ) {
          addSubject(childValue);
        }
      }

      appendExpectationSatellites(bySubject, expectationValue, addSubject);
    }
  }

  for (const subjectValue of [...subjectValues].sort((left, right) => left.localeCompare(right))) {
    addSubject(subjectValue);
  }

  return ordered;
}

function isTopLevelSubject(subject: Quad["subject"], refCounts: Map<string, number>): boolean {
  if (subject.termType === "NamedNode") {
    return true;
  }
  if (!isBlankNode(subject)) {
    return true;
  }
  return (refCounts.get(subject.value) ?? 0) !== 1;
}

function polishOutsideQuotes(line: string, replacer: (segment: string) => string): string {
  const parts = line.split(/("(?:\\.|[^"\\])*")/g);
  return parts
    .map((part, index) => (index % 2 === 1 ? part : replacer(part)))
    .join("");
}

function polishTurtleLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return line;
  }
  if (trimmed.startsWith("@prefix")) {
    return line.replace(/\.\s*$/, " .");
  }

  let polished = polishOutsideQuotes(line, (segment) => segment.replace(/;(?!\s)/g, " ;"));

  if (/[;[]\s*$/.test(trimmed)) {
    polished = polished.replace(/\s*$/, "");
  } else if (/\]\s*\.\s*$/.test(trimmed)) {
    polished = polished.replace(/\]\s*\.\s*$/, "] .");
  } else if (trimmed.endsWith(".")) {
    polished = polished.replace(/\.\s*$/, " .");
  }

  return polished;
}

const TURTLE_INDENT = "    ";

function countBracketsOutsideQuotes(line: string): { open: number; close: number } {
  const parts = line.split(/("(?:\\.|[^"\\])*")/g);
  let open = 0;
  let close = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const segment = parts[index];
    open += (segment.match(/\[/g) ?? []).length;
    close += (segment.match(/\]/g) ?? []).length;
  }
  return { open, close };
}

function normalizeClosingBracketLine(content: string): string {
  if (/^]\s*\.\s*$/.test(content)) {
    return "] .";
  }
  if (/^]\s*;\s*$/.test(content)) {
    return "] ;";
  }
  if (/^]\s*;\s*\.\s*$/.test(content)) {
    return "] .";
  }
  return content;
}

function isSubjectDeclaration(content: string): boolean {
  return /^data5g:\S+\s+a\b/.test(content);
}

function predicateIndentLevel(depth: number, content: string): number {
  if (depth === 0 && isSubjectDeclaration(content)) {
    return 0;
  }
  if (depth === 0 && /^data5g:/.test(content)) {
    return 1;
  }
  return depth + 1;
}

function reindentTurtleBody(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let bracketDepth = 0;
  let prefixBlockEnded = false;
  let previousSubjectEnded = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("@prefix")) {
      output.push(polishTurtleLine(trimmed));
      continue;
    }

    if (!prefixBlockEnded) {
      if (output.length > 0) {
        output.push("");
      }
      prefixBlockEnded = true;
    }

    const content = normalizeClosingBracketLine(trimmed);
    const isNewSubject = bracketDepth === 0 && isSubjectDeclaration(content);
    if (isNewSubject && previousSubjectEnded && output.at(-1) !== "") {
      output.push("");
    }
    previousSubjectEnded = false;

    const { open, close } = countBracketsOutsideQuotes(content);
    const indent = TURTLE_INDENT.repeat(predicateIndentLevel(bracketDepth, content));
    output.push(`${indent}${polishTurtleLine(content)}`);

    bracketDepth += open - close;
    bracketDepth = Math.max(0, bracketDepth);

    if (bracketDepth === 0 && /\s\.\s*$/.test(content)) {
      previousSubjectEnded = true;
    }
  }

  return output.join("\n");
}

function wrapCommaSeparatedPredicate(line: string, predicate: string): string {
  const match = line.match(
    new RegExp(`^(\\s*)(${predicate})\\s+(.+?)(\\s*)([;.])\\s*$`),
  );
  if (!match) {
    return line;
  }

  const [, indent, pred, values, , terminator] = match;
  const refs = values
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (refs.length <= 1) {
    return line;
  }

  const valueColumn = indent.length + pred.length + 1;
  const continuationIndent = " ".repeat(valueColumn);
  const wrappedValues = refs
    .map((ref, index) => (index === 0 ? ref : `\n${continuationIndent}${ref}`))
    .join(", ");
  const ending = terminator === "." ? " ." : " ;";
  return `${indent}${pred} ${wrappedValues}${ending}`;
}

function wrapLongPredicateLists(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let wrapped = wrapCommaSeparatedPredicate(line, "log:allOf");
      wrapped = wrapCommaSeparatedPredicate(wrapped, "data5g:coordinates");
      return wrapped;
    })
    .join("\n");
}

function ensurePrefixBodyBreak(text: string): string {
  const lines = text.split("\n");
  let lastPrefixIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("@prefix")) {
      lastPrefixIndex = index;
      continue;
    }
    if (!trimmed || lastPrefixIndex < 0) {
      continue;
    }
    if (index === lastPrefixIndex + 1) {
      lines.splice(index, 0, "");
    }
    break;
  }

  return lines.join("\n");
}

function insertSectionBreaks(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const previous = output.at(-1)?.trim() ?? "";
    if (
      isSubjectDeclaration(trimmed) &&
      previous.endsWith(".") &&
      !previous.startsWith("@prefix")
    ) {
      output.push("");
    }

    output.push(line);
  }

  return output.join("\n");
}

function splitRepeatedObjectLists(text: string): string {
  return text.replace(/^(\s*)(\S+)\s+(a\s+[^;]+);$/gm, (full, indent, subject, typeObjects) => {
    const types = typeObjects
      .replace(/^a\s+/, "")
      .split(",")
      .map((type: string) => type.trim())
      .filter(Boolean);
    if (types.length <= 1) {
      return full;
    }
    const continuationIndent = `${indent}    `;
    return `${indent}${subject} a ${types[0]},\n${continuationIndent}${types.slice(1).join(`,\n${continuationIndent}`)} ;`;
  });
}

function polishTurtleOutput(serialized: string): string {
  const listSpaced = serialized
    .replace(/\(([^\s)])/g, "( $1")
    .replace(/([^\s(])\)/g, "$1 )");
  const splitLists = splitRepeatedObjectLists(listSpaced);
  const reindented = reindentTurtleBody(splitLists);
  const wrapped = wrapLongPredicateLists(reindented);
  const sectioned = insertSectionBreaks(wrapped);
  const withPrefixBreak = ensurePrefixBodyBreak(sectioned);
  return ensureCoordinationUtilityLiteralTypes(withPrefixBreak);
}

function serializeQuadsWithInlineBlanks(quads: Quad[], prefixes: Record<string, string>): string {
  const refCounts = blankObjectRefCounts(quads);
  const bySubject = quadsBySubject(quads);
  const writer = new Writer({ format: "text/turtle", prefixes });

  const topLevelSubjectValues = [...bySubject.keys()]
    .map((value) => bySubject.get(value)?.[0]?.subject)
    .filter((subject): subject is Quad["subject"] => Boolean(subject))
    .filter((subject) => isTopLevelSubject(subject, refCounts))
    .map((subject) => subject.value);

  const orderedSubjectValues = buildIntentSubjectOrder(bySubject, topLevelSubjectValues);
  const topLevelSubjects = orderedSubjectValues
    .map((value) => bySubject.get(value)?.[0]?.subject)
    .filter((subject): subject is Quad["subject"] => Boolean(subject));

  for (const subject of topLevelSubjects) {
    const subjectQuads = sortQuadsForSubject(bySubject.get(subject.value) ?? []);
    for (const quad of subjectQuads) {
      writer.addQuad(
        quad.subject,
        quad.predicate,
        encodeObject(writer, quad.object, refCounts, bySubject) as Quad["object"],
        quad.graph,
      );
    }
  }

  let result = "";
  writer.end((error, serialized) => {
    if (error) {
      throw error;
    }
    result = serialized;
  });
  return polishTurtleOutput(result.trim());
}

/**
 * Parse and re-serialize Turtle for display (Intent-Simulator uses rdflib the same way).
 * Single-reference blank nodes use `[ ... ]`; RDF lists use `( ... )`.
 * Returns the original string when parsing or serialization fails.
 */
export function prettyPrintIntentTurtle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parser = new Parser({ format: "text/turtle" });
    const quads = parser.parse(trimmed);
    if (!Array.isArray(quads) || quads.length === 0) {
      return trimmed;
    }

    const allPrefixes = mergePrefixes(trimmed);
    const prefixes = selectPrefixesForQuads(quads, allPrefixes);
    const formatted = serializeQuadsWithInlineBlanks(quads, prefixes);
    return formatted.length > 0 ? formatted : trimmed;
  } catch {
    return trimmed;
  }
}
