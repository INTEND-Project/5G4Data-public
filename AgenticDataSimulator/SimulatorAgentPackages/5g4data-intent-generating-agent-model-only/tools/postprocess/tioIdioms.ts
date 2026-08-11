/**
 * Ensures generated intents follow TIO idioms required by Ericsson shapes:
 * - icm:target values are typed as icm:Target
 * - data5g:*Expectation subjects also declare icm:Expectation (+ IntentElement)
 *
 * Named targets are also declared in ../../data5g-onto for offline tio-shacl
 * ontology merge; this postprocessor embeds the same triples in emitted Turtle
 * so agent-side SHACL (data graph only) stays TIO-compliant.
 */

const EXPECTATION_CLASSES = [
  "DeploymentExpectation",
  "NetworkExpectation",
  "SustainabilityExpectation",
  "CoordinationExpectation",
  "ExplanationExpectation"
] as const;

const KNOWN_TARGETS = [
  "deployment",
  "network-slice",
  "sustainability",
  "coordination-service",
  "llm-service"
] as const;

function looksLikeTurtleIntent(text: string): boolean {
  return (
    /@prefix\s+\S+/m.test(text) &&
    (text.includes("icm:Intent") || text.includes("imo:Intent"))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectReferencedTargets(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\bicm:target\s+data5g:([A-Za-z0-9_-]+)\b/g)) {
    const local = match[1];
    if (local) found.add(local);
  }
  const ordered: string[] = [];
  for (const known of KNOWN_TARGETS) {
    if (found.has(known)) ordered.push(known);
  }
  for (const local of [...found].sort()) {
    if (!ordered.includes(local)) ordered.push(local);
  }
  return ordered;
}

function hasTargetTyping(text: string, local: string): boolean {
  const re = new RegExp(`data5g:${escapeRegExp(local)}\\s+a\\s+[^;.]*\\bicm:Target\\b`, "i");
  return re.test(text);
}

function ensureExpectationTyping(text: string): { text: string; changes: number } {
  let changes = 0;
  let out = text;
  for (const cls of EXPECTATION_CLASSES) {
    const re = new RegExp(
      `(data5g:[A-Za-z0-9_]+\\s+a\\s+)([^;.]*\\bdata5g:${cls}\\b[^;.]*)([;.])`,
      "gi"
    );
    out = out.replace(re, (full, prefix: string, typeList: string, end: string) => {
      if (/\bicm:Expectation\b/i.test(typeList)) return full;
      changes += 1;
      const updated = typeList.replace(new RegExp(`\\bdata5g:${cls}\\b`, "i"), (token) => {
        let insert = `${token}, icm:Expectation`;
        if (!/\bicm:IntentElement\b/i.test(typeList)) {
          insert += ", icm:IntentElement";
        }
        return insert;
      });
      return `${prefix}${updated}${end}`;
    });
  }
  return { text: out, changes };
}

function injectTargetTypings(text: string, targets: string[]): { text: string; changes: number } {
  const missing = targets.filter((local) => !hasTargetTyping(text, local));
  if (missing.length === 0) return { text, changes: 0 };

  const block =
    "\n# TIO idiom: named targets must be instances of icm:Target\n" +
    missing.map((local) => `data5g:${local} a icm:Target .`).join("\n") +
    "\n";

  const lines = text.split("\n");
  let insertAt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i]?.trim() ?? "";
    if (t.startsWith("@prefix")) insertAt = i + 1;
    else if (t === "" && insertAt > 0) insertAt = i + 1;
    else if (insertAt > 0 && t !== "") break;
  }
  lines.splice(insertAt, 0, ...block.split("\n"));
  return { text: lines.join("\n"), changes: missing.length };
}

export function applyPostprocessor(args: {
  text: string;
  context: Record<string, unknown>;
}): { text: string; changes: number; note?: string } {
  if (!looksLikeTurtleIntent(args.text)) {
    return { text: args.text, changes: 0 };
  }

  const typed = ensureExpectationTyping(args.text);
  const targets = collectReferencedTargets(typed.text);
  const withTargets = injectTargetTypings(typed.text, targets);
  const changes = typed.changes + withTargets.changes;

  return {
    text: withTargets.text,
    changes,
    note:
      changes > 0
        ? `tioIdioms: expectation typing=${typed.changes}, icm:Target inject=${withTargets.changes}`
        : undefined
  };
}
