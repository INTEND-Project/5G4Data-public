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

function firstConditionAnchor(expBlock: string, prefix: "DE" | "SE" | "NE" | "CE"): string {
  const allOfMatch = expBlock.match(/log:allOf\s+([^;]+)/is);
  if (!allOfMatch?.[1]) return `${prefix}unknown`;
  const tokens = allOfMatch[1].match(/data5g:(CO|NE|CX)([A-Za-z0-9]+)/gi) ?? [];
  for (const token of tokens) {
    const local = token.replace(/^data5g:/i, "");
    if (local.startsWith("CO")) return local;
    if (local.startsWith("NE")) return local;
  }
  return `${prefix}unknown`;
}

function parseEventExpectationMap(text: string): Map<string, { expPrefix: "DE" | "SE" | "NE" | "CE"; expId: string }> {
  const map = new Map<string, { expPrefix: "DE" | "SE" | "NE" | "CE"; expId: string }>();
  const re =
    /data5g:([A-Za-z0-9_]+)\s+a\s+rdfs:Class[\s\S]*?imo:eventFor\s+data5g:(DE|SE|NE|CE)([A-Za-z0-9_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    map.set(match[1], { expPrefix: match[2] as "DE" | "SE" | "NE" | "CE", expId: match[3] });
  }
  return map;
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
  return `data5g:${eventLocal} a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
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
      expPrefix = link.expPrefix;
      expId = link.expId;
    } else {
      const targetKey = block.targetLocal.replace(/^data5g:/i, "");
      const expRe = new RegExp(
        String.raw`data5g:(${expPrefix}[A-Za-z0-9_]+)\s+a[\s\S]*?icm:target\s+data5g:${targetKey}`,
        "i"
      );
      const expMatch = text.match(expRe);
      if (expMatch?.[1]) {
        expId = expMatch[1].slice(expPrefix.length);
      }
    }

    if (!expId) continue;

    const expBlock = extractExpectationBlock(text, expId, expPrefix);
    const anchor =
      expBlock && !expBlock.includes("unknown")
        ? firstConditionAnchor(expBlock, expPrefix)
        : `${expPrefix}${expId}`;

    const eventLocal = `${intervalLabel}ReportEvent${kind}_${anchor}`;
    const durationLocal = `duration${kind}_${anchor}`;
    const expectationRef = `data5g:${expPrefix}${expId}`;

    newEventLocals.add(eventLocal);
    newDurationLocals.add(durationLocal);

    if (block.triggerEvent) {
      if (GLOBAL_EVENT_LOCALS.has(block.triggerEvent) || block.triggerEvent !== eventLocal) {
        oldLocalsToRemove.add(block.triggerEvent);
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

  const referenced = new Set<string>();
  for (const m of text.matchAll(/data5g:([A-Za-z0-9_]+)/g)) {
    referenced.add(m[1]);
  }
  for (const local of oldLocalsToRemove) {
    if (!referenced.has(local) || GLOBAL_EVENT_LOCALS.has(local) || GLOBAL_DURATION_LOCALS.has(local)) {
      text = removeSubjectBlocks(text, new Set([local]));
      changes += 1;
    }
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
