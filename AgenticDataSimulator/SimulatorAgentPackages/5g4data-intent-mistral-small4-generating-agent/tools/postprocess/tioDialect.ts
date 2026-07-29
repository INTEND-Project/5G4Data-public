/**
 * TIO dialect normalizations for 5G4Data mistral intent Turtle:
 * - icm:Condition → log:Condition
 * - quan:larger → quan:greater
 * - imo:handler/owner string literals → data5g:<name> IntentManager IRIs
 * - report events: rdfs:Class + subClassOf imo:Event → a imo:Event
 * - log:allOf / set:forAll / valuesOfTargetProperty / quan:* → RDF list arguments
 * - quantity blank nodes typed as quan:Quantity
 */

const MANAGER_NAMES = ["inServ", "inChat", "inOrch", "inSustain", "inCoord"] as const;

function looksLikeTurtleIntent(text: string): boolean {
  return (
    /@prefix\s+\S+/m.test(text) &&
    (text.includes("icm:Intent") || text.includes("imo:Intent"))
  );
}

/** Build Turtle RDF list from already-prefixed member tokens. */
export function rdfList(members: string[]): string {
  return `( ${members.filter(Boolean).join(" ")} )`;
}

/** Format log:allOf from data5g local names. */
export function formatLogAllOf(locals: string[]): string {
  return `log:allOf ${rdfList(locals.map((l) => (l.startsWith("data5g:") ? l : `data5g:${l}`)))}`;
}

export function formatConditionBlock(args: {
  coLocal: string;
  description: string;
  propLocal: string;
  quantifier: string;
  unit: string;
  threshold: string | number;
}): string {
  const q = args.quantifier === "quan:larger" ? "quan:greater" : args.quantifier;
  const memberLocal = `member_${args.coLocal}`;
  return `data5g:${memberLocal} a quan:Quantity ;
    rdf:value "0"^^xsd:decimal .

data5g:${args.coLocal} a log:Condition ;
    dct:description "${args.description.replace(/"/g, '\\"')}" ;
    set:forAll (
        data5g:${memberLocal}
        [ icm:valuesOfTargetProperty ( data5g:${args.propLocal} ) ]
        [ ${q} (
            data5g:${memberLocal}
            [ a quan:Quantity ; quan:unit "${String(args.unit).replace(/"/g, '\\"')}" ;
                    rdf:value ${args.threshold} ]
          ) ]
    ) .`;
}

export function formatReportEventBlock(args: {
  eventLocal: string;
  durationLocal: string;
  expectationLocal: string;
}): string {
  return `data5g:${args.eventLocal} a imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:${args.durationLocal} ) ;
    imo:eventFor data5g:${args.expectationLocal} .`;
}

function splitCommaMembers(body: string): string[] {
  return body
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0);
}

/** Convert comma-separated predicate objects to an RDF list when not already a list. */
function convertPredicateToRdfList(text: string, predicate: string): { text: string; changes: number } {
  let changes = 0;
  const re = new RegExp(`(${predicate}\\s+)(?!\\()([^;.]+?)(\\s*[;.])`, "gis");
  const out = text.replace(re, (_full, prefix: string, body: string, end: string) => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.startsWith("(")) return `${prefix}${body}${end}`;
    // Blank-node object: wrap as single-element list
    if (trimmed.startsWith("[")) {
      changes += 1;
      return `${prefix}( ${trimmed} )${end}`;
    }
    const members = splitCommaMembers(trimmed);
    if (members.length === 0) return `${prefix}${body}${end}`;
    changes += 1;
    return `${prefix}${rdfList(members)}${end}`;
  });
  return { text: out, changes };
}

function wrapFunctionArgs(text: string, fn: string): { text: string; changes: number } {
  let changes = 0;
  // fn TOKEN  or fn [ blank ]  → fn ( TOKEN ) / fn ( [ blank ] )
  const re = new RegExp(`(${fn}\\s+)(?!\\()(\\[(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*\\]|data5g:[A-Za-z0-9_-]+)`, "gis");
  const out = text.replace(re, (_full, prefix: string, arg: string) => {
    changes += 1;
    return `${prefix}( ${arg.trim()} )`;
  });
  return { text: out, changes };
}

function ensureQuantityTyping(text: string): { text: string; changes: number } {
  let changes = 0;
  // Inside quan:greater|smaller|atLeast|inRange list args: [ quan:unit → [ a quan:Quantity ; quan:unit
  const out = text.replace(
    /(\(\s*)\[\s*(?!a\s+quan:Quantity)(quan:unit\b)/gi,
    (_full, open: string, unit: string) => {
      changes += 1;
      return `${open}[ a quan:Quantity ; ${unit}`;
    }
  );
  return { text: out, changes };
}

function fixReportEvents(text: string): { text: string; changes: number } {
  let changes = 0;
  const out = text.replace(
    /(data5g:[A-Za-z0-9_]+)\s+a\s+rdfs:Class\s*;\s*\n\s*rdfs:subClassOf\s+imo:Event\s*;/gi,
    (_full, subject: string) => {
      changes += 1;
      return `${subject} a imo:Event ;`;
    }
  );
  return { text: out, changes };
}

function fixManagers(text: string): { text: string; changes: number } {
  let changes = 0;
  let out = text;
  for (const pred of ["imo:handler", "imo:owner"]) {
    const re = new RegExp(`${pred}\\s+"([^"]+)"`, "gi");
    out = out.replace(re, (_full, name: string) => {
      changes += 1;
      return `${pred} data5g:${name}`;
    });
  }

  const needed = new Set<string>();
  for (const name of MANAGER_NAMES) {
    if (new RegExp(`\\b(?:imo:handler|imo:owner)\\s+data5g:${name}\\b`).test(out)) {
      needed.add(name);
    }
  }
  // Also catch any data5g: manager referenced
  for (const match of out.matchAll(/\b(?:imo:handler|imo:owner)\s+data5g:([A-Za-z0-9_-]+)/g)) {
    if (match[1]) needed.add(match[1]);
  }

  const missing = [...needed].filter(
    (name) => !new RegExp(`data5g:${name}\\s+a\\s+[^;.]*\\bimo:IntentManager\\b`, "i").test(out)
  );
  if (missing.length > 0) {
    const block =
      "\n# TIO idiom: handler/owner must be imo:IntentManager instances\n" +
      missing.map((name) => `data5g:${name} a imo:IntentManager .`).join("\n") +
      "\n";
    const lines = out.split("\n");
    let insertAt = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]?.trim() ?? "";
      if (t.startsWith("@prefix")) insertAt = i + 1;
      else if (t === "" && insertAt > 0) insertAt = i + 1;
      else if (t.startsWith("# TIO idiom")) insertAt = i + 1;
      else if (insertAt > 0 && t !== "" && !t.startsWith("#")) break;
    }
    lines.splice(insertAt, 0, ...block.split("\n"));
    out = lines.join("\n");
    changes += missing.length;
  }
  return { text: out, changes };
}

export function applyPostprocessor(args: {
  text: string;
  context: Record<string, unknown>;
}): { text: string; changes: number; note?: string } {
  if (!looksLikeTurtleIntent(args.text)) {
    return { text: args.text, changes: 0 };
  }

  let text = args.text;
  let changes = 0;

  const cond = (text.match(/\bicm:Condition\b/g) || []).length;
  if (cond > 0) {
    text = text.replace(/\bicm:Condition\b/g, "log:Condition");
    changes += cond;
  }

  const larger = (text.match(/\bquan:larger\b/g) || []).length;
  if (larger > 0) {
    text = text.replace(/\bquan:larger\b/g, "quan:greater");
    changes += larger;
  }

  const events = fixReportEvents(text);
  text = events.text;
  changes += events.changes;

  const managers = fixManagers(text);
  text = managers.text;
  changes += managers.changes;

  for (const pred of ["log:allOf", "set:forAll"]) {
    const r = convertPredicateToRdfList(text, pred);
    text = r.text;
    changes += r.changes;
  }

  for (const fn of [
    "icm:valuesOfTargetProperty",
    "quan:greater",
    "quan:smaller",
    "quan:atLeast",
    "quan:inRange"
  ]) {
    const r = wrapFunctionArgs(text, fn);
    text = r.text;
    changes += r.changes;
  }

  const qty = ensureQuantityTyping(text);
  text = qty.text;
  changes += qty.changes;

  return {
    text,
    changes,
    note: changes > 0 ? `tioDialect: ${changes} fix(es)` : undefined
  };
}
