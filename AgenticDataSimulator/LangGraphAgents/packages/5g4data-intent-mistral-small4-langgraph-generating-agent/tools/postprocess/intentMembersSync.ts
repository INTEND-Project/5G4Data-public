function findIntentLocal(text: string): string | null {
  const match = text.match(/\bdata5g:(I[0-9a-fA-F]{32})\s+a\s+icm:Intent\b/i);
  return match?.[1] ?? null;
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
    if (char === '"') {
      inString = !inString;
    }
  }
  return !inString;
}

function skipSubjectBlockLines(lines: string[], start: number, currentLocal: string): number {
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

function coLocalFromConstraintTail(constraintTail: string): string | null {
  const metricMatch = constraintTail.match(/valuesOfTargetProperty\s+data5g:([^\s;\]]+)/i);
  return (
    metricMatch?.[1]?.match(/(CO[A-Za-z0-9_]+)$/i)?.[1] ??
    metricMatch?.[1]?.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) ??
    null
  );
}

function materializeConstraintOnIntent(
  text: string,
  intentLocal: string,
  block: string,
  constraintTail: string,
): { text: string; changes: number } {
  const coLocal = coLocalFromConstraintTail(constraintTail);
  if (!coLocal) return { text, changes: 0 };

  const cleanedIntent = block.replace(constraintTail, "").replace(/\s*;\s*$/, " .");
  let result = text.replace(block, cleanedIntent);
  if (!new RegExp(String.raw`\bdata5g:${coLocal}\s+a\b`).test(result)) {
    const descMatch = constraintTail.match(/dct:description\s+"(?:\\.|[^"\\])*"\s*;/i);
    const metricStem =
      constraintTail.match(/valuesOfTargetProperty\s+data5g:([^_\s;\]]+)_/i)?.[1] ?? "metric";
    const descLine = descMatch
      ? `    ${descMatch[0]}\n`
      : `    dct:description "${metricStem} condition." ;\n`;
    const body = constraintTail
      .replace(/^\s*dct:description\s+"(?:\\.|[^"\\])*"\s*;\s*/i, "")
      .replace(/log:allOf\s+\[/i, "set:forAll [");
    const coBlock = `data5g:${coLocal} a icm:Condition ;\n${descLine}    ${body.trim()}`;
    result = `${result.trim()}\n\n${coBlock}`;
  }
  return { text: result, changes: 1 };
}

function stripMisplacedIntentConditionTail(text: string, intentLocal: string): { text: string; changes: number } {
  const block = extractSubjectBlock(text, intentLocal);
  if (!block) return { text, changes: 0 };

  const bracketTail = block.match(
    /((?:log|set):(?:allOf|forAll)\s+data5g:(?:DE|SE|NE|CE|RE)[\s\S]*?;)\s*((?:log|set):(?:allOf|forAll)\s+\[[\s\S]*?\]\s*\.)\s*$/i,
  );
  if (bracketTail?.[2]) {
    return materializeConstraintOnIntent(text, intentLocal, block, bracketTail[2]);
  }

  const proseTail = block.match(
    /((?:log|set):(?:allOf|forAll)\s+data5g:(?:DE|SE|NE|CE|RE)[\s\S]*?;)\s*(\s*dct:description\s+"(?:\\.|[^"\\])*"\s*;\s*(?:log|set):(?:allOf|forAll)\s+\[[\s\S]*?\]\s*\.)\s*$/i,
  );
  if (proseTail?.[2]) {
    return materializeConstraintOnIntent(text, intentLocal, block, proseTail[2].trim());
  }

  return { text, changes: 0 };
}

function removeSubjectBlock(text: string, local: string): string {
  const block = extractSubjectBlock(text, local);
  if (!block) return text;
  return text.replace(block, "").replace(/\n{3,}/g, "\n\n");
}

function collectExpectationLocals(text: string): string[] {
  const patterns: RegExp[] = [
    /data5g:(DE[A-Za-z0-9_]+)\s+a\s+data5g:DeploymentExpectation/gi,
    /data5g:(SE[A-Za-z0-9_]+)\s+a\s+data5g:SustainabilityExpectation/gi,
    /data5g:(NE[A-Za-z0-9_]+)\s+a\s+data5g:NetworkExpectation/gi,
    /data5g:(CE[A-Za-z0-9_]+)\s+a\s+data5g:CoordinationExpectation/gi,
    /data5g:(RE[A-Za-z0-9_]+)\s+a\s+icm:ObservationReportingExpectation/gi
  ];
  const locals = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) locals.add(match[1]);
    }
  }
  return [...locals];
}

function reportingTargetLocal(reBlock: string): string | null {
  const match = reBlock.match(/icm:target\s+data5g:([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function stripNetworkExpectation(text: string): { text: string; changes: number } {
  let result = text;
  let changes = 0;
  const neLocals = [...text.matchAll(/data5g:(NE[A-Za-z0-9_]+)\s+a\s+data5g:NetworkExpectation/gi)].map(
    (m) => m[1]
  );

  for (const neLocal of neLocals) {
    result = removeSubjectBlock(result, neLocal);
    changes += 1;
  }

  for (const match of [...text.matchAll(/data5g:(RE[A-Za-z0-9_]+)\s+a\s+icm:ObservationReportingExpectation/gi)]) {
    const reLocal = match[1];
    const block = extractSubjectBlock(result, reLocal);
    if (!block) continue;
    const target = reportingTargetLocal(block);
    if (target === "network-slice" || target === "network") {
      result = removeSubjectBlock(result, reLocal);
      changes += 1;
    }
  }

  return { text: result, changes };
}

function isConditionOrContext(text: string, local: string): boolean {
  const block = extractSubjectBlock(text, local);
  if (!block) return false;
  return /\ba\s+icm:Condition\b/i.test(block) || /\ba\s+icm:Context\b/i.test(block);
}

function findExistingContextLocal(text: string): string | null {
  const match = text.match(/\bdata5g:(CX[A-Za-z0-9_]+)\s+a\s+icm:Context\b/i);
  return match?.[1] ?? null;
}

function findDeploymentConditionLocal(text: string): string | null {
  const eventMatch = text.match(/ReportEventDeployment_(CO[A-Za-z0-9_]+)/i);
  if (eventMatch?.[1] && isConditionLocal(text, eventMatch[1])) {
    return eventMatch[1];
  }
  return findConditionLocalBeforeExpectation(text, "DE");
}

function findConditionLocalBeforeExpectation(text: string, expPrefix: "DE" | "SE" | "NE"): string | null {
  const expMatch = text.match(new RegExp(String.raw`\bdata5g:(${expPrefix}[A-Za-z0-9_]+)\s+a\b`, "i"));
  if (!expMatch?.[1]) return null;
  const expIndex = text.indexOf(expMatch[0]);
  for (const match of text.matchAll(/\bdata5g:(CO[A-Za-z0-9_]+)\s+a\s+icm:Condition\b/gi)) {
    if (match.index !== undefined && match.index < expIndex && match[1]) {
      return match[1];
    }
  }
  return null;
}

function isConditionLocal(text: string, local: string): boolean {
  const block = extractSubjectBlock(text, local);
  return block ? /\ba\s+icm:Condition\b/i.test(block) : false;
}

function dedupeIntentDescription(text: string, intentLocal: string): string {
  if (!intentLocal) return text;
  const block = extractSubjectBlock(text, intentLocal);
  if (!block) return text;
  let count = 0;
  const updated = block.replace(/dct:description\s+"(?:\\.|[^"\\])*"\s*;/gi, (match) => {
    count += 1;
    return count === 1 ? match : "";
  });
  if (count <= 1) return text;
  const cleaned = updated.replace(/\n[ \t]*\n/g, "\n");
  return text.replace(block, cleaned);
}

function parseLogAllOfBody(block: string): string | null {
  const match = block.match(/log:allOf\s+([\s\S]*?)(\s*[;.]\s*)$/im);
  return match?.[1]?.trim() ?? null;
}

function ensureDeploymentContexts(text: string): { text: string; changes: number } {
  let result = text;
  let changes = 0;
  const deLocals = [
    ...text.matchAll(/data5g:(DE[A-Za-z0-9_]+)\s+a\s+data5g:DeploymentExpectation/gi)
  ].map((match) => match[1]);

  for (const deLocal of deLocals) {
    if (!deLocal) continue;
    const deBlock = extractSubjectBlock(result, deLocal);
    if (!deBlock) continue;
    const allOfBody = parseLogAllOfBody(deBlock);
    if (!allOfBody) continue;

    const memberLocals = [...allOfBody.matchAll(/data5g:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    let validMembers = memberLocals.filter((local) => isConditionOrContext(result, local));
    const hasCondition = validMembers.some((local) => isConditionLocal(result, local));
    if (!hasCondition) {
      const coLocal = findDeploymentConditionLocal(result);
      if (coLocal && !validMembers.includes(coLocal)) {
        validMembers = [coLocal, ...validMembers];
        changes += 1;
      }
    } else {
      const deploymentCo = findDeploymentConditionLocal(result);
      if (deploymentCo && !validMembers.includes(deploymentCo)) {
        validMembers = [
          deploymentCo,
          ...validMembers.filter((local) => local !== deploymentCo),
        ];
        changes += 1;
      }
    }
    const hasContext = validMembers.some((local) => {
      const block = extractSubjectBlock(result, local);
      return block ? /\ba\s+icm:Context\b/i.test(block) : false;
    });

    let cxLocal = memberLocals.find((local) => local.startsWith("CX")) ?? findExistingContextLocal(result);
    if (!hasContext) {
      cxLocal = cxLocal ?? `CX_${deLocal}`;
      if (!new RegExp(String.raw`\bdata5g:${cxLocal}\s+a\b`).test(result)) {
        const descriptorMatch = result.match(/data5g:DeploymentDescriptor\s+"([^"]+)"/);
        const dcMatch = result.match(/data5g:DataCenter\s+"([^"]+)"/);
        const dc = dcMatch?.[1] ?? "";
        const descriptor = descriptorMatch?.[1] ?? "";
        const chartFromRuntime = result.match(/Selected chart:\s+(\S+)/i)?.[1];
        const chartFromDescriptor = descriptor.match(/\/charts\/([^/]+)\//)?.[1];
        const appName = chartFromRuntime ?? chartFromDescriptor ?? "";
        const cxLines = [`data5g:${cxLocal} a icm:Context ;`];
        if (dc) cxLines.push(`    data5g:DataCenter "${dc}" ;`);
        if (descriptor) {
          if (appName) cxLines.push(`    data5g:Application "${appName}" ;`);
          cxLines.push(`    data5g:DeploymentDescriptor "${descriptor}" .`);
        } else if (appName) {
          cxLines.push(`    data5g:Application "${appName}" .`);
        } else {
          cxLines.push(`    data5g:Application "workload" .`);
        }
        const insert = cxLines.join("\n");
        result = `${result.trim()}\n\n${insert}`;
        changes += 1;
      }
      if (cxLocal && !validMembers.includes(cxLocal)) validMembers.push(cxLocal);
    }

    const refs = validMembers.map((local) => `data5g:${local}`).join(",\n        ");
    if (refs.length === 0) continue;

    const updatedDe = deBlock.replace(
      /log:allOf\s+[\s\S]*?(\s*[;.]\s*)$/im,
      `log:allOf ${refs}$1`
    );
    if (updatedDe !== deBlock) {
      result = result.replace(deBlock, updatedDe);
      changes += 1;
    }
  }
  return { text: result, changes };
}

function sortExpectationMembers(locals: string[]): string[] {
  const rank = (local: string): number => {
    if (local.startsWith("DE")) return 0;
    if (local.startsWith("SE")) return 1;
    if (local.startsWith("NE")) return 2;
    if (local.startsWith("CE")) return 3;
    if (local.startsWith("RE")) return 4;
    return 5;
  };
  return [...locals].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function replaceIntentMemberList(block: string, refs: string): string | null {
  const lines = block.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/log:allOf\s+data5g:(?:DE|SE|NE|CE|RE)/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  let end = start;
  while (end < lines.length) {
    const trimmed = lines[end].trimEnd();
    if (trimmed.endsWith(";") || trimmed.endsWith(".")) {
      break;
    }
    end += 1;
  }
  if (end >= lines.length) return null;

  const terminator = lines[end].trimEnd().endsWith(".") ? "." : ";";
  const indent = lines[start].match(/^(\s*)/)?.[1] ?? "    ";
  const memberLine = `${indent}log:allOf ${refs}${terminator === "." ? " ." : " ;"}`;
  return [...lines.slice(0, start), memberLine, ...lines.slice(end + 1)].join("\n");
}

function syncIntentAllOf(text: string, intentLocal: string, members: string[]): string {
  if (members.length === 0) return text;
  const block = extractSubjectBlock(text, intentLocal);
  if (!block) return text;
  const refs = sortExpectationMembers(members)
    .map((local) => `data5g:${local}`)
    .join(",\n        ");

  const withMemberList = replaceIntentMemberList(block, refs);
  if (withMemberList) {
    return text.replace(block, withMemberList);
  }
  if (/imo:owner\s+"inChat"/i.test(block)) {
    const updated = block.replace(/imo:owner\s+"inChat"\s*;/i, `imo:owner "inChat" ;\n    log:allOf ${refs} ;`);
    return text.replace(block, updated);
  }
  return text;
}

export function applyPostprocessor(args: {
  text: string;
  context: { intentFlags?: Record<string, boolean> };
}): { text: string; changes: number; note?: string } {
  const flags = args.context.intentFlags ?? {};
  let text = args.text;
  let changes = 0;
  const notes: string[] = [];

  if (!flags.networkQos) {
    const stripped = stripNetworkExpectation(text);
    if (stripped.changes > 0) {
      text = stripped.text;
      changes += stripped.changes;
      notes.push("removed-spurious-network");
    }
  }

  const intentLocalEarly = findIntentLocal(text);
  if (intentLocalEarly) {
    const strippedTail = stripMisplacedIntentConditionTail(text, intentLocalEarly);
    if (strippedTail.changes > 0) {
      text = strippedTail.text;
      changes += 1;
      notes.push("stripped-intent-condition-tail");
    }
  }

  const deduped = dedupeIntentDescription(text, intentLocalEarly ?? "");
  if (deduped !== text) {
    text = deduped;
    changes += 1;
    notes.push("deduped-intent-description");
  }

  const ctxFix = ensureDeploymentContexts(text);
  if (ctxFix.changes > 0) {
    text = ctxFix.text;
    changes += ctxFix.changes;
    notes.push("deployment-context-in-allOf");
  }

  const intentLocal = findIntentLocal(text);
  if (!intentLocal) {
    return { text, changes, note: notes.join(", ") || undefined };
  }

  const members = collectExpectationLocals(text);
  const synced = syncIntentAllOf(text, intentLocal, members);
  if (synced !== text) {
    text = synced;
    changes += 1;
    notes.push(`synced-intent-allOf(${members.length})`);
  }

  return {
    text,
    changes,
    note: notes.length > 0 ? notes.join(", ") : undefined
  };
}
