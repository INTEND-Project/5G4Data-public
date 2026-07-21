/** Collapse duplicate RDF collection members in Turtle `], [` syntax. */

export function normalizeMember(member: string): string {
  return member.replace(/\s+/g, " ").trim();
}

function memberDedupeKey(member: string): string {
  const metricMatch = member.match(/valuesOfTargetProperty\s+data5g:([^\s;,]+)/i);
  if (metricMatch?.[1]) return `metric:${metricMatch[1]}`;
  return `text:${normalizeMember(member)}`;
}

/** Split collection inner text on top-level `], [` while respecting nested brackets/parens. */
export function splitCollectionMembers(inner: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === "[" || char === "(") {
      depth += 1;
      continue;
    }
    if (char === "]" || char === ")") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      if (char === "]") {
        const separator = inner.slice(i + 1).match(/^\s*,\s*\[/);
        if (separator) {
          members.push(inner.slice(start, i).trim());
          start = i + 1 + separator[0].length;
          i = start - 1;
        }
      }
      continue;
    }
  }

  const tail = inner.slice(start).trim();
  if (tail.length > 0) members.push(tail);
  return members;
}

export function dedupeCollection(inner: string): { text: string; changes: number } {
  const members = splitCollectionMembers(inner);
  if (members.length <= 1) return { text: inner, changes: 0 };

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const member of members) {
    const key = memberDedupeKey(member);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(member);
  }

  if (unique.length === members.length) return { text: inner, changes: 0 };
  return { text: unique.join(" ], [ "), changes: members.length - unique.length };
}

function extractCollectionMembers(
  block: string,
  predicate: string
): { prefix: string; suffix: string; members: string[] } | null {
  const re = new RegExp(String.raw`(\b${predicate}\s*)`, "i");
  const match = re.exec(block);
  if (!match?.[1] || match.index === undefined) return null;

  const prefixEnd = match.index + match[1].length;
  let i = prefixEnd;
  while (i < block.length && /\s/.test(block[i] ?? "")) i += 1;

  const members: string[] = [];
  while (i < block.length && block[i] === "[") {
    const memberStart = i + 1;
    let depth = 1;
    i += 1;
    while (i < block.length && depth > 0) {
      const char = block[i] ?? "";
      if (char === "[") depth += 1;
      else if (char === "]") depth -= 1;
      i += 1;
    }
    members.push(block.slice(memberStart, i - 1).trim());
    while (i < block.length && /\s/.test(block[i] ?? "")) i += 1;
    if (block[i] === ",") {
      i += 1;
      while (i < block.length && /\s/.test(block[i] ?? "")) i += 1;
      continue;
    }
    break;
  }

  if (members.length === 0) return null;
  return { prefix: block.slice(0, prefixEnd), suffix: block.slice(i), members };
}

function rebuildCollection(prefix: string, members: string[], suffix: string): string {
  const body =
    members.length === 1
      ? `[ ${members[0]} ]`
      : `[ ${members.join(" ], [ ")} ]`;
  return `${prefix}${body}${suffix}`;
}

export function dedupePredicateCollection(
  block: string,
  predicate: string
): { text: string; changes: number } {
  const extracted = extractCollectionMembers(block, predicate);
  if (!extracted) return { text: block, changes: 0 };

  const seen = new Set<string>();
  const unique: string[] = [];
  let changes = 0;
  for (const member of extracted.members) {
    const key = memberDedupeKey(member);
    if (seen.has(key)) {
      changes += 1;
      continue;
    }
    seen.add(key);
    unique.push(member);
  }

  if (changes === 0) return { text: block, changes: 0 };
  return {
    text: rebuildCollection(extracted.prefix, unique, extracted.suffix),
    changes
  };
}

export function dedupeTimeDelayTuples(block: string): { text: string; changes: number } {
  const delayRe = /time:delay\s+((?:\([^)]*\)(?:\s*,\s*)?)+)/gi;
  let changes = 0;
  const text = block.replace(delayRe, (_full, tupleGroup: string) => {
    const tuples = [...tupleGroup.matchAll(/\(\s*([^)]+)\s*\)/g)].map((m) => normalizeMember(m[1] ?? ""));
    if (tuples.length <= 1) return _full;
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const tuple of tuples) {
      if (seen.has(tuple)) continue;
      seen.add(tuple);
      unique.push(tuple);
    }
    if (unique.length === tuples.length) return _full;
    changes += tuples.length - unique.length;
    return `time:delay ( ${unique[0]} )`;
  });
  return { text, changes };
}

const EXPECTATION_TYPE_RE =
  /\ba\s+(?:data5g:)?(?:Deployment|Sustainability|Network|Coordination)Expectation\b/i;

export function stripMisplacedEventPredicates(block: string): { text: string; changes: number } {
  if (!EXPECTATION_TYPE_RE.test(block)) return { text: block, changes: 0 };

  let changes = 0;
  const lines = block.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    if (/^\s*imo:eventFor\b/i.test(line)) {
      changes += 1;
      continue;
    }
    if (/^\s*rdfs:subClassOf\s+imo:Event\b/i.test(line)) {
      changes += 1;
      continue;
    }
    if (/^\s*time:delay\b/i.test(line)) {
      changes += 1;
      continue;
    }
    kept.push(line);
  }

  if (changes === 0) return { text: block, changes: 0 };
  return { text: kept.join("\n").replace(/;\s*;/g, ";"), changes };
}

function isNewSubjectLine(line: string, currentLocal: string): boolean {
  const match = line.match(/^\s*data5g:([A-Za-z0-9_-]+)\s+a\b/i);
  if (!match?.[1]) return false;
  return match[1] !== currentLocal;
}

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
    if (char === '"') inString = !inString;
  }
  return !inString;
}

function extractSubjectBlocks(text: string): Array<{ local: string; block: string }> {
  const lines = text.split("\n");
  const blocks: Array<{ local: string; block: string }> = [];
  let i = 0;

  while (i < lines.length) {
    const subjectMatch = lines[i].match(/^\s*data5g:([A-Za-z0-9_-]+)\s+a\b/i);
    if (!subjectMatch?.[1]) {
      i += 1;
      continue;
    }
    const local = subjectMatch[1];
    const start = i;
    i += 1;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i += 1;
        continue;
      }
      if (isNewSubjectLine(line, local)) break;
      if (lineEndsSubjectTerminator(line)) {
        i += 1;
        break;
      }
      i += 1;
    }
    blocks.push({ local, block: lines.slice(start, i).join("\n") });
  }

  return blocks;
}

function processSubjectBlock(block: string): { text: string; changes: number } {
  let result = block;
  let changes = 0;

  if (/\bset:forAll\b/i.test(block) || /\blog:forAll\b/i.test(block)) {
    for (const predicate of ["set:forAll", "log:forAll"]) {
      const deduped = dedupePredicateCollection(result, predicate);
      if (deduped.changes > 0) {
        result = deduped.text;
        changes += deduped.changes;
      }
    }
  }

  if (/\ba\s+icm:ObservationReportingExpectation\b/i.test(block)) {
    for (const predicate of ["icm:reportDestinations", "icm:reportTriggers"]) {
      const deduped = dedupePredicateCollection(result, predicate);
      if (deduped.changes > 0) {
        result = deduped.text;
        changes += deduped.changes;
      }
    }
  }

  if (EXPECTATION_TYPE_RE.test(block)) {
    const stripped = stripMisplacedEventPredicates(result);
    if (stripped.changes > 0) {
      result = stripped.text;
      changes += stripped.changes;
    }
  }

  if (/\ba\s+rdfs:Class\b/i.test(block) || EXPECTATION_TYPE_RE.test(block)) {
    const delayDeduped = dedupeTimeDelayTuples(result);
    if (delayDeduped.changes > 0) {
      result = delayDeduped.text;
      changes += delayDeduped.changes;
    }
  }

  return { text: result, changes };
}

export function dedupeTurtleCollections(text: string): { text: string; changes: number } {
  const blocks = extractSubjectBlocks(text);
  if (blocks.length === 0) return { text, changes: 0 };

  let changes = 0;
  let result = text;
  for (const { block } of blocks) {
    const processed = processSubjectBlock(block);
    if (processed.changes > 0) {
      result = result.replace(block, processed.text);
      changes += processed.changes;
    }
  }
  return { text: result, changes };
}

export function applyPostprocessor(args: { text: string }): {
  text: string;
  changes: number;
  note?: string;
} {
  const deduped = dedupeTurtleCollections(args.text);
  return {
    text: deduped.text,
    changes: deduped.changes,
    note: deduped.changes > 0 ? `deduped ${deduped.changes} collection member(s)` : undefined
  };
}
