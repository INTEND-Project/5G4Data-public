/**
 * Lightweight Turtle fixes for LLM fragment bodies before syntax validation.
 */
const CONTINUATION_LINE =
  /^\s+(time:|ut:|log:|dct:|set:|quan:|rdfs:|imo:|icm:|geo:|data5g:|fun:|mf:)/;

function insertMissingSemicolons(lines: string[]): { lines: string[]; changes: number } {
  const out: string[] = [];
  let changes = 0;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const next = lines[i + 1];
    if (next && CONTINUATION_LINE.test(next)) {
      const trimmed = line.trimEnd();
      if (
        trimmed.length > 0 &&
        !trimmed.endsWith(";") &&
        !trimmed.endsWith(".") &&
        !trimmed.endsWith(",")
      ) {
        line = `${trimmed} ;`;
        changes += 1;
      }
    }
    if (
      next &&
      /^\s+icm:report(?:Destinations|Triggers)\s+\[/i.test(next) &&
      /\]\s*$/.test(line.trimEnd()) &&
      !line.trimEnd().endsWith(";")
    ) {
      line = `${line.trimEnd()} ;`;
      changes += 1;
    }
    out.push(line);
  }

  return { lines: out, changes };
}

function stripUnknownPrefixedTokens(text: string): { text: string; changes: number } {
  const lines = text.split("\n");
  const kept: string[] = [];
  let changes = 0;
  for (const line of lines) {
    if (/^@prefix\s/i.test(line.trim())) {
      changes += 1;
      continue;
    }
    if (/\bintend:/i.test(line)) {
      changes += 1;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), changes };
}

function stripIntentLevelFields(text: string): { text: string; changes: number } {
  const lines = text.split("\n");
  const kept: string[] = [];
  let changes = 0;
  for (const line of lines) {
    if (/^\s*imo:(?:handler|owner)\b/i.test(line)) {
      changes += 1;
      continue;
    }
    if (/^\s*in(?:Serv|Chat)\s*;?\s*$/i.test(line.trim())) {
      changes += 1;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n"), changes };
}

function applyGlobalRepairs(text: string): { text: string; changes: number } {
  let result = text;
  let changes = 0;

  const unknownPrefixes = stripUnknownPrefixedTokens(result);
  if (unknownPrefixes.changes > 0) {
    result = unknownPrefixes.text;
    changes += unknownPrefixes.changes;
  }

  const intentFields = stripIntentLevelFields(result);
  if (intentFields.changes > 0) {
    result = intentFields.text;
    changes += intentFields.changes;
  }

  const bracketBeforePredicate = result.replace(
    /(\])(?!\s*;)\s*\n(\s+(?:icm:|rdfs:|time:|imo:|dct:|set:|log:|data5g:|quan:))/g,
    "$1 ;\n$2"
  );
  if (bracketBeforePredicate !== result) {
    result = bracketBeforePredicate;
    changes += 1;
  }

  const reportContainers = result.replace(
    /(rdfs:member\s+data5g:prometheus\s*\])(?!\s*;)(\s*\n\s*icm:reportTriggers)/gi,
    "$1 ;$2"
  );
  if (reportContainers !== result) {
    result = reportContainers;
    changes += 1;
  }

  const orphanSemicolons = result.replace(/^\s*;\s*$/gm, "");
  if (orphanSemicolons !== result) {
    result = orphanSemicolons;
    changes += 1;
  }

  const duplicateSemicolons = result.replace(/;\s*;+/g, ";");
  if (duplicateSemicolons !== result) {
    result = duplicateSemicolons;
    changes += 1;
  }

  const bracketSemicolonDup = result.replace(/\]\s*;\s*\n\s*;\s*\n/g, "] ;\n");
  if (bracketSemicolonDup !== result) {
    result = bracketSemicolonDup;
    changes += 1;
  }

  const periodSemicolon = result.replace(/\.\s*;\s*(\n|$)/g, ".$1");
  if (periodSemicolon !== result) {
    result = periodSemicolon;
    changes += 1;
  }

  const dedupedBlank = result.replace(/\n{3,}/g, "\n\n");
  if (dedupedBlank !== result) {
    result = dedupedBlank;
    changes += 1;
  }

  return { text: result, changes };
}

function repairTruncatedTerminal(text: string): { text: string; changes: number } {
  const trimmed = text.trimEnd();
  if (!trimmed) return { text, changes: 0 };
  if (trimmed.endsWith(".")) return { text: trimmed, changes: 0 };

  const lines = trimmed.split("\n");
  const last = lines[lines.length - 1]?.trimEnd() ?? "";
  if (!last) return { text: trimmed, changes: 0 };

  if (last.endsWith(";")) {
    lines[lines.length - 1] = `${last} .`;
    return { text: lines.join("\n"), changes: 1 };
  }
  if (!last.endsWith(".")) {
    lines[lines.length - 1] = `${last} .`;
    return { text: lines.join("\n"), changes: 1 };
  }
  return { text: trimmed, changes: 0 };
}

function singlePass(
  text: string,
  opts?: { fragmentId?: string }
): { text: string; changes: number } {
  const semicolonPass = insertMissingSemicolons(text.split("\n"));
  let result = semicolonPass.lines.join("\n");
  let changes = semicolonPass.changes;

  const global = applyGlobalRepairs(result);
  result = global.text;
  changes += global.changes;

  if (opts?.fragmentId === "coordination") {
    const fixedCoordinates = result.replace(
      /(data5g:coordinates\s+data5g:[A-Za-z0-9_]+(?:\s*,\s*data5g:[A-Za-z0-9_]+)*)\s*(\n\s*time:)/gi,
      "$1 ;$2"
    );
    if (fixedCoordinates !== result) {
      result = fixedCoordinates;
      changes += 1;
    }
  }

  if (opts?.fragmentId === "deployment" || opts?.fragmentId === "sustainability") {
    const eofRepair = repairTruncatedTerminal(result);
    if (eofRepair.changes > 0) {
      result = eofRepair.text;
      changes += eofRepair.changes;
    }
  }

  return { text: result, changes };
}

export function normalizeFragmentTurtle(
  text: string,
  opts?: { fragmentId?: string }
): { text: string; changes: number } {
  let result = text;
  let changes = 0;

  for (let pass = 0; pass < 4; pass += 1) {
    const next = singlePass(result, opts);
    result = next.text;
    changes += next.changes;
    if (next.changes === 0) break;
  }

  return { text: result, changes };
}
