import { randomUUID } from "node:crypto";
import {
  clampReportingIntervalSeconds,
  formatIntervalLabelFromSeconds,
} from "./reportingIntervalLabel.js";

type ParsedObjective = {
  name: string;
  threshold: string;
  quantifier: string;
  unit: string;
};

type ParsedWorkloadContext = {
  chartName: string;
  chartVersion: string;
  deploymentDescriptor: string;
  dataCenter: string;
  deploymentObjectives: ParsedObjective[];
  sustainabilityObjectives: ParsedObjective[];
};

function newLocal(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "")}`;
}

function parseObjectiveLine(line: string): ParsedObjective | null {
  const match = line.match(
    /^-\s+([^:]+):\s*threshold=([^\s,]+)[^,]*(?:,\s*quantifier=([^\s(]+))?(?:[^,]*,\s*unit=([^\s(,]+))?/i
  );
  if (!match) return null;
  const name = match[1]?.trim() ?? "";
  const threshold = match[2]?.trim() ?? "";
  if (!name || !threshold || threshold === "unspecified") return null;
  const quantifierRaw = match[3]?.trim() ?? "quan:larger";
  const quantifier = quantifierRaw.startsWith("quan:") ? quantifierRaw : `quan:${quantifierRaw}`;
  const unit = match[4]?.trim() ?? "";
  return { name, threshold, quantifier, unit };
}

export function parseWorkloadContextFromRuntime(runtimeContext: string): ParsedWorkloadContext | null {
  if (!runtimeContext.includes("[selected workload objectives]")) return null;

  const chartMatch = runtimeContext.match(/Selected chart:\s+(\S+)\s+\(version\s+([^)]+)\)/i);
  const descriptorMatch = runtimeContext.match(/DeploymentDescriptor\s+"([^"]+)"/i)?.[1];
  const descriptorChartMatch = descriptorMatch?.match(/\/charts\/([^/]+)\/([^/"']+)/i);
  const chartName = chartMatch?.[1] ?? descriptorChartMatch?.[1] ?? "";
  const chartVersion = chartMatch?.[2] ?? descriptorChartMatch?.[2] ?? "";
  const deploymentDescriptor =
    descriptorMatch ??
    (chartName.length > 0 && chartVersion.length > 0
      ? `https://start5g-1.cs.uit.no/wchartmuseum/api/charts/${chartName}/${chartVersion}`
      : "");

  const dataCenter =
    runtimeContext.match(/DataCenter\s+"([^"]+)"/i)?.[1] ??
    runtimeContext.match(/Recommended nearest edge data center:\s*(\S+)/i)?.[1] ??
    "";

  const deploymentObjectives: ParsedObjective[] = [];
  const sustainabilityObjectives: ParsedObjective[] = [];
  let section: "none" | "deployment" | "sustainability" = "none";

  for (const rawLine of runtimeContext.split("\n")) {
    const line = rawLine.trim();
    if (/^Deployment objective defaults/i.test(line)) {
      section = "deployment";
      continue;
    }
    if (/^Sustainability objective defaults/i.test(line)) {
      section = "sustainability";
      continue;
    }
    if (!line.startsWith("-")) continue;
    const parsed = parseObjectiveLine(line);
    if (!parsed) continue;
    if (section === "deployment") deploymentObjectives.push(parsed);
    if (section === "sustainability") sustainabilityObjectives.push(parsed);
  }

  if (deploymentObjectives.length === 0 && sustainabilityObjectives.length === 0) {
    return null;
  }

  return {
    chartName,
    chartVersion,
    deploymentDescriptor,
    dataCenter,
    deploymentObjectives,
    sustainabilityObjectives
  };
}

function quantifierToken(quantifier: string): "larger" | "smaller" | "atLeast" {
  if (quantifier.includes("smaller")) return "smaller";
  if (quantifier.includes("atLeast")) return "atLeast";
  return "larger";
}

function renderConditionBlock(local: string, objective: ParsedObjective): string {
  const metricLocal = `${objective.name}_${local}`;
  const q = quantifierToken(objective.quantifier);
  const unitPart =
    objective.unit.length > 0
      ? `quan:unit "${objective.unit}" ;\n                    `
      : "";
  const thresholdNum = objective.threshold.replace(/[^\d.]/g, "") || objective.threshold;
  const unitSuffix = objective.unit.length > 0 ? ` ${objective.unit}` : "";
  return `data5g:${local} a icm:Condition ;
    dct:description "${objective.name} condition ${objective.quantifier}: ${thresholdNum}${unitSuffix}" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:${metricLocal} ;
            quan:${q} [ ${unitPart}rdf:value ${thresholdNum} ] ] .`;
}

function renderContextBlock(local: string, ctx: ParsedWorkloadContext): string {
  const dcLine =
    ctx.dataCenter.length > 0
      ? `    data5g:DataCenter "${ctx.dataCenter}" ;\n`
      : "";
  const appLine =
    ctx.chartName.length > 0 ? `    data5g:Application "${ctx.chartName}" ;\n` : "";
  const descriptorLine =
    ctx.deploymentDescriptor.length > 0
      ? `    data5g:DeploymentDescriptor "${ctx.deploymentDescriptor}" .`
      : "    data5g:Application \"workload\" .";
  return `data5g:${local} a icm:Context ;
${dcLine}${appLine}${descriptorLine}`;
}

function renderDeploymentExpectation(
  deLocal: string,
  coLocal: string,
  cxLocal: string,
  chartName: string
): string {
  return `data5g:${deLocal} a data5g:DeploymentExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "Deploy ${chartName} workload." ;
    icm:target data5g:deployment ;
    log:allOf data5g:${coLocal},
        data5g:${cxLocal} .`;
}

function renderSustainabilityExpectation(
  seLocal: string,
  coLocals: string[],
  cxLocal: string
): string {
  const refs = coLocals.map((local) => `data5g:${local}`).join(",\n        ");
  return `data5g:${seLocal} a data5g:SustainabilityExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "Ensure sustainable operation of workload." ;
    icm:target data5g:sustainability ;
    log:allOf ${refs},
        data5g:${cxLocal} .`;
}

type ReportingTarget = "deployment" | "sustainability" | "network-slice";
type ReportEventKind = "Deployment" | "Sustainability" | "Network";

function reportingTargetDescription(target: ReportingTarget): string {
  if (target === "deployment") return "Deployment observation reports on the configured interval.";
  if (target === "sustainability") return "Sustainability observation reports on the configured interval.";
  return "Network observation reports on the configured interval.";
}

function renderReportingExpectation(
  reLocal: string,
  target: ReportingTarget,
  eventLocal: string,
  storage: "prometheus" | "graphdb"
): string {
  return `data5g:${reLocal} a icm:ObservationReportingExpectation ;
    dct:description "${reportingTargetDescription(target)}" ;
    icm:target data5g:${target} ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:${storage} ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:${eventLocal} ] .`;
}

function renderReportEvent(
  eventLocal: string,
  durationLocal: string,
  kind: ReportEventKind,
  expectationLocal: string,
  intervalSeconds: number
): string {
  return `data5g:${durationLocal} a time:DurationDescription ;
    time:numericDuration "${intervalSeconds}"^^xsd:decimal ;
    time:unitType time:unitSecond .

data5g:${eventLocal} a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:${durationLocal} ) ;
    imo:eventFor data5g:${expectationLocal} .`;
}

function extractSubjectBlock(text: string, local: string): string | null {
  const start = text.search(new RegExp(String.raw`\bdata5g:${local}\s+a\b`, "i"));
  if (start < 0) return null;
  const tail = text.slice(start);
  const nextSubject = tail.slice(1).search(/\n\s*data5g:/);
  const end = nextSubject >= 0 ? start + 1 + nextSubject : text.length;
  return text.slice(start, end);
}

function parseNetworkExpectationLocal(text: string): string | null {
  const match = text.match(/\bdata5g:(NE[0-9a-fA-F]{32})\s+a\s+data5g:NetworkExpectation\b/i);
  return match?.[1] ?? null;
}

function hasNetworkExpectation(text: string): boolean {
  return /data5g:NetworkExpectation/.test(text);
}

function hasNetworkReportingExpectation(text: string): boolean {
  return /icm:ObservationReportingExpectation[\s\S]*?icm:target\s+data5g:network-slice\b/i.test(text);
}

function firstConditionAnchorInExpectation(expBlock: string): string | null {
  const allOfMatch = expBlock.match(/log:allOf\s+([^;]+)/is);
  if (!allOfMatch?.[1]) return null;
  const coMatch = allOfMatch[1].match(/\bdata5g:(CO[0-9a-fA-F]{32})\b/i);
  return coMatch?.[1] ?? null;
}

function resolveReportingIntervalSeconds(context: {
  reportingIntervalSeconds?: number;
}): number {
  if (context.reportingIntervalSeconds !== undefined && context.reportingIntervalSeconds !== null) {
    return clampReportingIntervalSeconds(context.reportingIntervalSeconds);
  }
  return 60;
}

function appendIntentAllOfMembers(text: string, intentLocal: string, newMembers: string[]): string {
  const intentPattern = new RegExp(
    String.raw`(data5g:${intentLocal}\s+a\s+icm:Intent\s*;[\s\S]*?log:allOf\s+)([^;]+)(;)`,
    "i"
  );
  const match = text.match(intentPattern);
  if (!match?.[2]) return text;
  const existing = match[2];
  const toAdd = newMembers.filter((local) => !existing.includes(`data5g:${local}`));
  if (toAdd.length === 0) return text;
  const refs = toAdd.map((local) => `data5g:${local}`).join(",\n        ");
  const updated = `${existing.trimEnd()},\n        ${refs}`;
  return text.replace(intentPattern, `$1${updated}$3`);
}

function augmentNetworkReportingExpectation(
  text: string,
  context: { reportingIntervalSeconds?: number; runtimeContext?: string }
): { text: string; changes: number } {
  if (!hasNetworkExpectation(text) || hasNetworkReportingExpectation(text)) {
    return { text, changes: 0 };
  }

  const neLocal = parseNetworkExpectationLocal(text);
  if (!neLocal) return { text, changes: 0 };

  const neBlock = extractSubjectBlock(text, neLocal);
  const anchorCo = (neBlock && firstConditionAnchorInExpectation(neBlock)) ?? neLocal;
  const intervalSeconds = resolveReportingIntervalSeconds(context);
  const intervalLabel = formatIntervalLabelFromSeconds(intervalSeconds);
  const reLocal = newLocal("RE");
  const durationLocal = `durationNetwork_${anchorCo}`;
  const eventLocal = `${intervalLabel}ReportEventNetwork_${anchorCo}`;
  const storage = detectReportStorage(text, context.runtimeContext ?? "");

  const blocks = [
    renderReportEvent(eventLocal, durationLocal, "Network", neLocal, intervalSeconds),
    renderReportingExpectation(reLocal, "network-slice", eventLocal, storage),
  ];

  let updated = `${text.trim()}\n\n${blocks.join("\n\n")}`;
  const intentLocal = findIntentLocal(updated);
  if (intentLocal) {
    updated = appendIntentAllOfMembers(updated, intentLocal, [reLocal]);
  }

  return { text: updated, changes: 1 };
}

function detectReportStorage(text: string, runtimeContext: string): "prometheus" | "graphdb" {
  if (/data5g:prometheus/.test(text)) return "prometheus";
  if (/Observation report storage for this intent:\s*prometheus/i.test(runtimeContext)) {
    return "prometheus";
  }
  return "graphdb";
}

function upsertIntentAllOf(text: string, intentLocal: string, members: string[]): string {
  const refs = members.map((local) => `data5g:${local}`).join(",\n        ");
  const intentPattern = new RegExp(
    String.raw`(data5g:${intentLocal}\s+a\s+icm:Intent\s*;[\s\S]*?log:allOf\s+)([^;]+)(;)`,
    "i"
  );
  if (intentPattern.test(text)) {
    return text.replace(intentPattern, `$1${refs}$3`);
  }
  const intentBlockPattern = new RegExp(
    String.raw`(data5g:${intentLocal}\s+a\s+icm:Intent\s*;[\s\S]*?imo:owner\s+"inChat"\s*;)`,
    "i"
  );
  if (intentBlockPattern.test(text)) {
    return text.replace(intentBlockPattern, `$1\n    log:allOf ${refs} ;`);
  }
  return text;
}

function findIntentLocal(text: string): string | null {
  const match = text.match(/\bdata5g:(I[0-9a-fA-F]{32})\s+a\s+icm:Intent\b/i);
  return match?.[1] ?? null;
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    intentFlags?: Record<string, boolean>;
    runtimeContext?: string;
    userPrompt?: string;
    reportingIntervalSeconds?: number;
  };
}): { text: string; changes: number; note?: string } {
  const flags = args.context.intentFlags ?? {};
  const needsDeployment = Boolean(flags.deployment);
  const needsSustainability = Boolean(flags.sustainability);
  const needsNetwork = Boolean(flags.networkQos);

  if (
    hasNetworkExpectation(args.text) &&
    !hasNetworkReportingExpectation(args.text)
  ) {
    const augmented = augmentNetworkReportingExpectation(args.text, args.context);
    if (augmented.changes > 0) {
      return {
        text: augmented.text,
        changes: augmented.changes,
        note: "workloadExpectations: added network ObservationReportingExpectation for existing NetworkExpectation",
      };
    }
  }

  if (!needsDeployment && !needsSustainability && !needsNetwork) {
    return { text: args.text, changes: 0 };
  }
  if (!args.text.includes("icm:Intent")) {
    return { text: args.text, changes: 0 };
  }

  const parsed = parseWorkloadContextFromRuntime(args.context.runtimeContext ?? "");
  if (!parsed) return { text: args.text, changes: 0 };

  const hasDe = /data5g:DeploymentExpectation/.test(args.text);
  const hasSe = /data5g:SustainabilityExpectation/.test(args.text);
  const hasDataCenter = /data5g:DataCenter\s+"[^"]+"/.test(args.text);
  const needsScaffold =
    (needsDeployment && !hasDe) ||
    (needsSustainability && !hasSe) ||
    ((needsDeployment || needsSustainability) && parsed.dataCenter.length > 0 && !hasDataCenter);

  if (!needsScaffold) return { text: args.text, changes: 0 };

  let text = args.text;
  let changes = 0;
  const intentLocal = findIntentLocal(text) ?? newLocal("I");
  const cxLocal = newLocal("CX");
  const blocks: string[] = [];
  const intentMembers: string[] = [];

  if (needsDeployment && !hasDe && parsed.deploymentObjectives.length > 0) {
    const deLocal = newLocal("DE");
    const coLocal = newLocal("CO");
    const reLocal = newLocal("RE");
    const intervalSeconds = resolveReportingIntervalSeconds(args.context);
    const intervalLabel = formatIntervalLabelFromSeconds(intervalSeconds);
    const durationLocal = `durationDeployment_${coLocal}`;
    const eventLocal = `${intervalLabel}ReportEventDeployment_${coLocal}`;
    blocks.push(renderConditionBlock(coLocal, parsed.deploymentObjectives[0]));
    blocks.push(renderDeploymentExpectation(deLocal, coLocal, cxLocal, parsed.chartName));
    blocks.push(renderReportEvent(eventLocal, durationLocal, "Deployment", deLocal, intervalSeconds));
    blocks.push(renderReportingExpectation(reLocal, "deployment", eventLocal, detectReportStorage(text, args.context.runtimeContext ?? "")));
    intentMembers.push(deLocal, reLocal);
    changes += 1;
  }

  if (needsSustainability && !hasSe && parsed.sustainabilityObjectives.length > 0) {
    const seLocal = newLocal("SE");
    const coLocals: string[] = [];
    for (const objective of parsed.sustainabilityObjectives) {
      const coLocal = newLocal("CO");
      coLocals.push(coLocal);
      blocks.push(renderConditionBlock(coLocal, objective));
    }
    const reLocal = newLocal("RE");
    const anchorCo = coLocals[0] ?? newLocal("CO");
    const intervalSeconds = resolveReportingIntervalSeconds(args.context);
    const intervalLabel = formatIntervalLabelFromSeconds(intervalSeconds);
    const durationLocal = `durationSustainability_${anchorCo}`;
    const eventLocal = `${intervalLabel}ReportEventSustainability_${anchorCo}`;
    blocks.push(renderSustainabilityExpectation(seLocal, coLocals, cxLocal));
    blocks.push(renderReportEvent(eventLocal, durationLocal, "Sustainability", seLocal, intervalSeconds));
    blocks.push(renderReportingExpectation(reLocal, "sustainability", eventLocal, detectReportStorage(text, args.context.runtimeContext ?? "")));
    intentMembers.push(seLocal, reLocal);
    changes += 1;
  }

  if (blocks.length === 0) return { text: args.text, changes: 0 };

  if (!hasDataCenter && parsed.dataCenter.length > 0) {
    blocks.unshift(renderContextBlock(cxLocal, parsed));
  }

  if (!text.includes(`data5g:${intentLocal}`)) {
    const intentHeader = `data5g:${intentLocal} a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" .`;
    text = `${text.trim()}\n\n${intentHeader}`;
    changes += 1;
  }

  text = `${text.trim()}\n\n${blocks.join("\n\n")}`;
  text = upsertIntentAllOf(text, intentLocal, intentMembers);
  changes += 1;

  return {
    text,
    changes,
    note: "workloadExpectations: scaffolded deployment/sustainability expectations from runtime context"
  };
}

export { parseObjectiveLine };
