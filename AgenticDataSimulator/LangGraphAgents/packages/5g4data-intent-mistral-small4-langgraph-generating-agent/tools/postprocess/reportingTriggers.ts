import {
  clampReportingIntervalMinutes,
  clampReportingIntervalSeconds,
  formatIntervalLabel,
  formatIntervalLabelFromSeconds
} from "./reportingIntervalLabel.js";

type DurationUnit = "second" | "minute";

function resolveReportingDuration(context: {
  reportingIntervalSeconds?: number;
  reportingIntervalMinutes?: number;
}): { value: number; unit: DurationUnit; intervalLabel: string } {
  if (context.reportingIntervalSeconds !== undefined && context.reportingIntervalSeconds !== null) {
    const seconds = clampReportingIntervalSeconds(context.reportingIntervalSeconds);
    return {
      value: seconds,
      unit: "second",
      intervalLabel: formatIntervalLabelFromSeconds(seconds)
    };
  }
  const minutes = clampReportingIntervalMinutes(context.reportingIntervalMinutes ?? 10);
  return {
    value: minutes,
    unit: "minute",
    intervalLabel: formatIntervalLabel(minutes)
  };
}

type ReportKind = "Deployment" | "Sustainability" | "Network" | "Coordination";

const GLOBAL_EVENT_LOCALS = new Set([
  "TenMinuteReportEventDeployment",
  "TenMinuteReportEventSustainability",
  "TenMinuteReportEventNetwork",
  "FiveMinuteReportEventDeployment",
  "FiveMinuteReportEventSustainability",
  "FiveMinuteReportEventNetwork"
]);

const GLOBAL_DURATION_LOCALS = new Set([
  "tenMinutesDeployment",
  "tenMinutesSustainability",
  "tenMinutesNetwork",
  "fiveMinutesDeployment",
  "fiveMinutesSustainability",
  "fiveMinutesNetwork"
]);

function kindFromTarget(targetLocal: string): ReportKind | null {
  const t = targetLocal.replace(/^data5g:/i, "").trim();
  if (t === "deployment") return "Deployment";
  if (t === "sustainability") return "Sustainability";
  if (t === "network-slice" || t === "network") return "Network";
  if (t === "llm-service" || t === "coordination-service") return "Coordination";
  return null;
}

function extractPredicateLocal(block: string, predicate: string): string | null {
  const re = new RegExp(
    String.raw`${predicate}\s+data5g:([A-Za-z0-9_]+)`,
    "i"
  );
  const match = block.match(re);
  return match?.[1] ?? null;
}

function extractTriggerEventLocal(reBlock: string): string | null {
  const memberMatch = reBlock.match(
    /reportTriggers\s*\[[^\]]*rdfs:member\s+data5g:([A-Za-z0-9_]+)/is
  );
  if (memberMatch?.[1]) return memberMatch[1];
  const shortMatch = reBlock.match(/reportTriggers\s*\[\s*rdfs:member\s+data5g:([A-Za-z0-9_]+)/is);
  return shortMatch?.[1] ?? null;
}

function extractSubjectBlock(text: string, local: string): string | null {
  const start = text.search(new RegExp(String.raw`\bdata5g:${local}\s+a\b`, "i"));
  if (start < 0) return null;
  const tail = text.slice(start);
  const nextSubject = tail.slice(1).search(/\n\s*data5g:/);
  const end = nextSubject >= 0 ? start + 1 + nextSubject : text.length;
  return text.slice(start, end);
}

function extractExpectationBlock(
  text: string,
  expId: string,
  prefix: "DE" | "SE" | "NE" | "CE",
): string | null {
  return extractSubjectBlock(text, `${prefix}${expId}`);
}

/** Prefer a CO/NE/CE member of log:allOf; never invent "*unknown" anchors. */
function firstConditionAnchor(expBlock: string, expectationLocal: string): string {
  const allOfMatch = expBlock.match(/log:allOf\s+([^;.]+)/is);
  if (!allOfMatch?.[1]) return expectationLocal;
  const tokens = allOfMatch[1].match(/data5g:(CO|NE|CE)([A-Za-z0-9_]+)/gi) ?? [];
  for (const token of tokens) {
    const local = token.replace(/^data5g:/i, "");
    if (/^CO/i.test(local) || /^NE/i.test(local) || /^CE/i.test(local)) return local;
  }
  return expectationLocal;
}

/** Reject LLM typos like data5g:DEployment / *unknown that are not real expectation subjects. */
function isRealExpectation(
  text: string,
  expPrefix: "DE" | "SE" | "NE" | "CE",
  expId: string
): boolean {
  if (!expId || /^unknown$/i.test(expId) || /^ployment$/i.test(expId)) return false;
  const local = `${expPrefix}${expId}`;
  return new RegExp(String.raw`\bdata5g:${local}\s+a\b`, "i").test(text);
}

function parseEventExpectationMap(text: string): Map<string, { expPrefix: "DE" | "SE" | "NE" | "CE"; expId: string }> {
  const map = new Map<string, { expPrefix: "DE" | "SE" | "NE" | "CE"; expId: string }>();
  // Match both legacy rdfs:Class+subClassOf and current a imo:Event dialect.
  const re =
    /data5g:([A-Za-z0-9_]+)\s+a\s+(?:rdfs:Class|imo:Event)\b[\s\S]*?imo:eventFor\s+data5g:(DE|SE|NE|CE)([A-Za-z0-9_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const expPrefix = match[2] as "DE" | "SE" | "NE" | "CE";
    const expId = match[3];
    if (!isRealExpectation(text, expPrefix, expId)) continue;
    map.set(match[1], { expPrefix, expId });
  }
  return map;
}

function durationLocalFromEventBlock(eventBlock: string): string | null {
  const match = eventBlock.match(
    /time:delay\s*\(\s*data5g:lastReportInstant\s+data5g:([A-Za-z0-9_]+)/i
  );
  return match?.[1] ?? null;
}

function findExpectationByTarget(
  text: string,
  expPrefix: "DE" | "SE" | "NE" | "CE",
  targetKey: string
): string | null {
  const expRe = new RegExp(
    String.raw`data5g:(${expPrefix}[A-Za-z0-9_]+)\s+a[\s\S]*?icm:target\s+data5g:${targetKey}\b`,
    "i"
  );
  const expMatch = text.match(expRe);
  if (!expMatch?.[1]) return null;
  const expId = expMatch[1].slice(expPrefix.length);
  return isRealExpectation(text, expPrefix, expId) ? expId : null;
}

function parseReportingExpectations(text: string): Array<{
  reLocal: string;
  reBlock: string;
  targetLocal: string;
  triggerEvent: string | null;
}> {
  const out: Array<{
    reLocal: string;
    reBlock: string;
    targetLocal: string;
    triggerEvent: string | null;
  }> = [];
  const reHeader =
    /data5g:(RE(?:[0-9a-fA-F]{32}|[A-Za-z0-9_]+))\s+a\s+icm:ObservationReportingExpectation/gi;
  let match: RegExpExecArray | null;
  while ((match = reHeader.exec(text)) !== null) {
    const reLocal = match[1];
    const start = match.index;
    const nextSubject = text.slice(start + match[0].length).search(/\n\s*data5g:/);
    const end = nextSubject >= 0 ? start + match[0].length + nextSubject : text.length;
    const reBlock = text.slice(start, end);
    const targetRaw = extractPredicateLocal(reBlock, "icm:target");
    const targetLocal = targetRaw ? `data5g:${targetRaw}` : "";
    out.push({
      reLocal,
      reBlock,
      targetLocal,
      triggerEvent: extractTriggerEventLocal(reBlock)
    });
  }
  return out;
}

function buildDurationBlock(durationLocal: string, value: number, unit: DurationUnit): string {
  const unitType = unit === "second" ? "time:unitSecond" : "time:unitMinute";
  return `data5g:${durationLocal} a time:DurationDescription ;
    time:numericDuration "${value}"^^xsd:decimal ;
    time:unitType ${unitType} .`;
}

function buildEventBlock(
  eventLocal: string,
  durationLocal: string,
  expectationRef: string
): string {
  return `data5g:${eventLocal} a imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:${durationLocal} ) ;
    imo:eventFor ${expectationRef} .`;
}

function removeSubjectBlocks(text: string, locals: Set<string>): string {
  let result = text;
  for (const local of locals) {
    const blockRe = new RegExp(
      String.raw`\n?data5g:${local}\s+a[^.]*\.(\s*\n)?`,
      "gis"
    );
    result = result.replace(blockRe, "\n");
  }
  return result.replace(/\n{3,}/g, "\n\n");
}

function stripExpectationDurationLines(text: string): { text: string; changes: number } {
  const lines = text.split("\n");
  const out: string[] = [];
  let inExpectation = false;
  let changes = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      /\ba\s+data5g:(?:Deployment|Sustainability|Coordination)Expectation\b/i.test(line) ||
      /\ba\s+[^;]*data5g:(?:Deployment|Sustainability|Coordination)Expectation\b/i.test(line)
    ) {
      inExpectation = true;
      out.push(line);
      continue;
    }

    if (inExpectation && /^\s*time:(?:numericDuration|unitType)\b/i.test(line)) {
      changes += 1;
      let j = i + 1;
      while (j < lines.length && /^\s*time:(?:numericDuration|unitType)\b/i.test(lines[j])) {
        changes += 1;
        j += 1;
      }
      const nextLine = lines[j] ?? "";
      if (/^\s*data5g:[A-Za-z0-9_]+\s+a\b/.test(nextLine) && out.length > 0) {
        const lastIdx = out.length - 1;
        if (out[lastIdx].trimEnd().endsWith(";")) {
          out[lastIdx] = out[lastIdx].replace(/;\s*$/, " .");
          changes += 1;
        }
      }
      i = j - 1;
      inExpectation = false;
      continue;
    }

    if (inExpectation && /^\s*data5g:[A-Za-z0-9_]+\s+a\b/.test(line)) {
      inExpectation = false;
    }

    out.push(line);
  }

  return { text: out.join("\n"), changes };
}

function closeDanglingExpectationSemicolons(text: string): { text: string; changes: number } {
  const lines = text.split("\n");
  const out: string[] = [];
  let inExpectation = false;
  let changes = 0;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    if (/\b(?:Deployment|Sustainability|Coordination)Expectation\b/.test(line)) {
      inExpectation = true;
    }

    if (inExpectation && line.trimEnd().endsWith(";")) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") {
        j += 1;
      }
      const next = lines[j] ?? "";
      if (/^\s*data5g:[A-Za-z0-9_]+\s+a\b/.test(next) && !/^\s*time:/i.test(next)) {
        line = line.replace(/;\s*$/, " .");
        changes += 1;
        inExpectation = false;
      }
    }

    if (inExpectation && /^\s*data5g:[A-Za-z0-9_]+\s+a\b/.test(line) && !/\b(?:Deployment|Sustainability|Coordination)Expectation\b/.test(line)) {
      inExpectation = false;
    }

    out.push(line);
  }

  return { text: out.join("\n"), changes };
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    reportingIntervalMinutes?: number;
    reportingIntervalSeconds?: number;
  };
}): { text: string; changes: number; note?: string } {
  const duration = resolveReportingDuration(args.context);
  const { value, unit, intervalLabel } = duration;
  let text = args.text;
  let changes = 0;

  const strippedDurations = stripExpectationDurationLines(text);
  const closed = closeDanglingExpectationSemicolons(strippedDurations.text);
  text = closed.text;
  changes += strippedDurations.changes + closed.changes;

  if (!/icm:ObservationReportingExpectation/i.test(text)) {
    return {
      text,
      changes,
      note:
        changes > 0 ? "reportingTriggers: stripped expectation inline durations" : undefined
    };
  }

  const eventMap = parseEventExpectationMap(text);
  const reportingBlocks = parseReportingExpectations(text);
  const newEventLocals = new Set<string>();
  const newDurationLocals = new Set<string>();
  const oldLocalsToRemove = new Set<string>();

  for (const block of reportingBlocks) {
    const kind = kindFromTarget(block.targetLocal);
    if (!kind) continue;

    let expPrefix: "DE" | "SE" | "NE" | "CE" =
      kind === "Deployment"
        ? "DE"
        : kind === "Sustainability"
          ? "SE"
          : kind === "Coordination"
            ? "CE"
            : "NE";
    let expId = "";

    if (block.triggerEvent && eventMap.has(block.triggerEvent)) {
      const link = eventMap.get(block.triggerEvent)!;
      if (isRealExpectation(text, link.expPrefix, link.expId)) {
        expPrefix = link.expPrefix;
        expId = link.expId;
      }
    }
    if (!expId) {
      const targetKey = block.targetLocal.replace(/^data5g:/i, "");
      expId = findExpectationByTarget(text, expPrefix, targetKey) ?? "";
    }

    if (!expId) continue;

    const expectationLocal = `${expPrefix}${expId}`;
    const expBlock = extractExpectationBlock(text, expId, expPrefix);
    const anchor = expBlock
      ? firstConditionAnchor(expBlock, expectationLocal)
      : expectationLocal;

    const eventLocal = `${intervalLabel}ReportEvent${kind}_${anchor}`;
    const durationLocal = `duration${kind}_${anchor}`;
    const expectationRef = `data5g:${expectationLocal}`;

    newEventLocals.add(eventLocal);
    newDurationLocals.add(durationLocal);

    if (block.triggerEvent) {
      if (GLOBAL_EVENT_LOCALS.has(block.triggerEvent) || block.triggerEvent !== eventLocal) {
        oldLocalsToRemove.add(block.triggerEvent);
        const oldEventBlock = extractSubjectBlock(text, block.triggerEvent);
        const oldDuration = oldEventBlock ? durationLocalFromEventBlock(oldEventBlock) : null;
        if (oldDuration && !newDurationLocals.has(oldDuration)) {
          oldLocalsToRemove.add(oldDuration);
        }
        changes += 1;
      }
      text = text.replace(
        new RegExp(
          String.raw`(data5g:${block.reLocal}[\s\S]*?reportTriggers\s*\[[^\]]*rdfs:member\s+)data5g:${block.triggerEvent}`,
          "i"
        ),
        `$1data5g:${eventLocal}`
      );
      text = text.replace(
        new RegExp(String.raw`(reportTriggers\s*\[\s*rdfs:member\s+)data5g:${block.triggerEvent}`, "i"),
        `$1data5g:${eventLocal}`
      );
    }

    const durationBlock = buildDurationBlock(durationLocal, value, unit);
    const eventBlock = buildEventBlock(eventLocal, durationLocal, expectationRef);

    if (!new RegExp(String.raw`\bdata5g:${durationLocal}\s+a\b`).test(text)) {
      text = `${text.trimEnd()}\n\n${durationBlock}\n\n${eventBlock}\n`;
      changes += 2;
    } else {
      text = text.replace(
        new RegExp(String.raw`data5g:${durationLocal}[^.]*\.`, "is"),
        `${durationBlock}\n`
      );
      text = text.replace(
        new RegExp(String.raw`data5g:${eventLocal}[^.]*\.`, "is"),
        `${eventBlock}\n`
      );
      changes += 1;
    }

    for (const [oldEvent, link] of eventMap.entries()) {
      if (link.expId === expId && link.expPrefix === expPrefix && oldEvent !== eventLocal) {
        oldLocalsToRemove.add(oldEvent);
        const oldEventBlock = extractSubjectBlock(text, oldEvent);
        const oldDuration = oldEventBlock ? durationLocalFromEventBlock(oldEventBlock) : null;
        if (oldDuration && !newDurationLocals.has(oldDuration)) {
          oldLocalsToRemove.add(oldDuration);
        }
      }
    }
  }

  // Sweep leftover bogus anchors from earlier LLM / postprocessor runs.
  for (const m of text.matchAll(
    /\bdata5g:((?:Ten|Five|\d+)(?:Minute|Second)ReportEvent(?:Deployment|Sustainability|Network|Coordination)_(?:DE|SE|NE|CE)(?:unknown|ployment))\b/gi
  )) {
    oldLocalsToRemove.add(m[1]);
  }
  for (const m of text.matchAll(
    /\bdata5g:(duration(?:Deployment|Sustainability|Network|Coordination)_(?:DE|SE|NE|CE)(?:unknown|ployment))\b/gi
  )) {
    oldLocalsToRemove.add(m[1]);
  }
  // Orphan events whose eventFor does not name a real expectation subject.
  for (const m of text.matchAll(
    /data5g:([A-Za-z0-9_]+)\s+a\s+(?:rdfs:Class|imo:Event)\b[\s\S]*?imo:eventFor\s+data5g:(DE|SE|NE|CE)([A-Za-z0-9_]+)/gi
  )) {
    const eventLocal = m[1];
    const expPrefix = m[2] as "DE" | "SE" | "NE" | "CE";
    const expId = m[3];
    if (newEventLocals.has(eventLocal)) continue;
    if (!isRealExpectation(text, expPrefix, expId)) {
      oldLocalsToRemove.add(eventLocal);
      const oldEventBlock = extractSubjectBlock(text, eventLocal);
      const oldDuration = oldEventBlock ? durationLocalFromEventBlock(oldEventBlock) : null;
      if (oldDuration && !newDurationLocals.has(oldDuration)) {
        oldLocalsToRemove.add(oldDuration);
      }
    }
  }

  for (const local of GLOBAL_DURATION_LOCALS) {
    if (new RegExp(String.raw`\bdata5g:${local}\b`).test(text) && !newDurationLocals.has(local)) {
      oldLocalsToRemove.add(local);
    }
  }
  for (const local of GLOBAL_EVENT_LOCALS) {
    if (new RegExp(String.raw`\bdata5g:${local}\b`).test(text) && !newEventLocals.has(local)) {
      oldLocalsToRemove.add(local);
    }
  }

  // Always drop collected obsolete subjects (self-mentions must not keep them alive).
  const removable = new Set(
    [...oldLocalsToRemove].filter((local) => !newEventLocals.has(local) && !newDurationLocals.has(local))
  );
  if (removable.size > 0) {
    text = removeSubjectBlocks(text, removable);
    changes += removable.size;
  }

  text = removeSubjectBlocks(text, new Set([...GLOBAL_EVENT_LOCALS, ...GLOBAL_DURATION_LOCALS].filter(
    (l) => text.includes(`data5g:${l}`) && !newEventLocals.has(l) && !newDurationLocals.has(l)
  )));

  return {
    text,
    changes,
    note:
      changes > 0
        ? `reportingTriggers: ${intervalLabel} (${value} ${unit}(s)), ${reportingBlocks.length} RE block(s)`
        : undefined
  };
}
