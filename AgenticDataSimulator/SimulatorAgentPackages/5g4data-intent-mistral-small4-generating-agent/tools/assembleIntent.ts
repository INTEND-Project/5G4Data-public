import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface IntentDraftFragment {
  id: string;
  turtle: string;
  locals: string[];
}

export interface IntentDraft {
  intentDescription: string;
  fragments: IntentDraftFragment[];
}

function escapeTurtleString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function intentDescriptionFromPrompt(userPrompt: string, draftDescription: string): string {
  const draft = draftDescription.trim();
  if (draft && !draft.toLowerCase().includes("observation report storage")) {
    return draft;
  }
  const lines = userPrompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const substantive = lines.filter(
    (line) =>
      !line.toLowerCase().includes("observation report storage") &&
      !line.toLowerCase().includes("observationreportingexpectation")
  );
  return substantive[substantive.length - 1] ?? draft ?? "Generated intent";
}

function rankMemberLocal(local: string): number {
  if (local.startsWith("DE")) return 0;
  if (local.startsWith("SE")) return 1;
  if (local.startsWith("NE")) return 2;
  if (local.startsWith("CE")) return 3;
  if (local.startsWith("RE")) return 4;
  return 5;
}

function collectExpectationLocals(fragments: IntentDraftFragment[]): string[] {
  const locals = new Set<string>();
  const patterns = [
    /\bdata5g:(DE[A-Za-z0-9_]+)\s+a\b/gi,
    /\bdata5g:(SE[A-Za-z0-9_]+)\s+a\b/gi,
    /\bdata5g:(NE[A-Za-z0-9_]+)\s+a\b/gi,
    /\bdata5g:(CE[A-Za-z0-9_]+)\s+a\b/gi,
    /\bdata5g:(RE[A-Za-z0-9_]+)\s+a\s+icm:ObservationReportingExpectation\b/gi
  ];
  for (const fragment of fragments) {
    for (const pattern of patterns) {
      for (const match of fragment.turtle.matchAll(pattern)) {
        if (match[1]) locals.add(match[1]);
      }
    }
    for (const local of fragment.locals) {
      if (/^(DE|SE|NE|CE|RE)/.test(local)) locals.add(local);
    }
  }
  return [...locals].sort((a, b) => rankMemberLocal(a) - rankMemberLocal(b) || a.localeCompare(b));
}

function dedupeSubjectBlocks(turtle: string): string {
  const blocks: string[] = [];
  const seen = new Set<string>();
  const lines = turtle.split("\n");
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
      const trimmed = lines[i].trimEnd();
      if (trimmed.endsWith(".") && !trimmed.endsWith("..")) {
        i += 1;
        break;
      }
      if (i > start && /^\s*data5g:[A-Za-z0-9_-]+\s+a\b/i.test(lines[i])) {
        break;
      }
      i += 1;
    }
    const block = lines.slice(start, i).join("\n").trim();
    if (!seen.has(local)) {
      seen.add(local);
      blocks.push(block);
    }
  }
  return blocks.join("\n\n");
}

export function assembleIntent(args: {
  draft: IntentDraft;
  packageDir: string;
  userPrompt: string;
  canonicalPrefixesFile?: string;
}): { text: string; intentLocal: string; members: string[] } {
  const prefixesFile =
    args.canonicalPrefixesFile ?? join(args.packageDir, "templates", "canonical-prefixes.ttl");
  const prefixes = readFileSync(prefixesFile, "utf8").trim();
  const intentLocal = "I__ID_INTENT_1__";
  const description = intentDescriptionFromPrompt(args.userPrompt, args.draft.intentDescription);
  const members = collectExpectationLocals(args.draft.fragments);
  const refs =
    members.length > 0
      ? members.map((local) => `data5g:${local}`).join(",\n        ")
      : "";
  const intentBlock = refs
    ? `data5g:${intentLocal} a icm:Intent ;
    dct:description "${escapeTurtleString(description)}" ;
    imo:handler "inServ" ;
    imo:owner "inChat" ;
    log:allOf ${refs} .`
    : `data5g:${intentLocal} a icm:Intent ;
    dct:description "${escapeTurtleString(description)}" ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;

  const body = args.draft.fragments
    .map((f) => f.turtle.trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
  const dedupedBody = dedupeSubjectBlocks(body);
  const text = `${prefixes}\n\n${intentBlock}\n\n${dedupedBody}`.trim();
  return { text, intentLocal, members };
}
