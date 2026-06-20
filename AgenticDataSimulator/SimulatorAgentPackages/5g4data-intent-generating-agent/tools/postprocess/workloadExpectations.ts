import { randomUUID } from "node:crypto";

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

function hasResolvedDataCenter(text: string): boolean {
  const match = text.match(/data5g:DataCenter\s+"([^"]+)"/);
  if (!match) return false;
  const value = match[1]?.trim().toLowerCase() ?? "";
  return value.length > 0 && value !== "<data-center>";
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
  const chartName = chartMatch?.[1] ?? "rusty-llm";
  const chartVersion = chartMatch?.[2] ?? "0.1.19";
  const deploymentDescriptor =
    runtimeContext.match(/DeploymentDescriptor\s+"([^"]+)"/i)?.[1] ??
    `https://start5g-1.cs.uit.no/wchartmuseum/api/charts/${chartName}/${chartVersion}`;

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
  return `data5g:${local} a icm:Context ;
${dcLine}    data5g:Application "LLM inference" ;
    data5g:DeploymentDescriptor "${ctx.deploymentDescriptor}" .`;
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

function renderReportingExpectation(
  reLocal: string,
  target: "deployment" | "sustainability",
  eventLocal: string,
  storage: "prometheus" | "graphdb"
): string {
  return `data5g:${reLocal} a icm:ObservationReportingExpectation ;
    dct:description "${target === "deployment" ? "Deployment" : "Sustainability"} observation reports." ;
    icm:target data5g:${target} ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:${storage} ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:${eventLocal} ] .`;
}

function renderReportEvent(
  eventLocal: string,
  durationLocal: string,
  kind: "Deployment" | "Sustainability",
  deOrSeLocal: string
): string {
  return `data5g:${durationLocal} a time:DurationDescription ;
    time:numericDuration "60"^^xsd:decimal ;
    time:unitType time:unitSecond .

data5g:${eventLocal} a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:${durationLocal} ) ;
    imo:eventFor data5g:${deOrSeLocal} .`;
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
  if (!needsDeployment && !needsSustainability) {
    return { text: args.text, changes: 0 };
  }

  const parsed = parseWorkloadContextFromRuntime(args.context.runtimeContext ?? "");
  if (
    parsed &&
    !hasResolvedDataCenter(args.text) &&
    parsed.dataCenter.length > 0 &&
    args.text.includes('data5g:DataCenter "<data-center>"')
  ) {
    const replaced = args.text.replace(
      /data5g:DataCenter\s+"<data-center>"/g,
      `data5g:DataCenter "${parsed.dataCenter}"`,
    );
    if (replaced !== args.text) {
      return {
        text: replaced,
        changes: 1,
        note: "workloadExpectations: replaced data-center placeholder from runtime context",
      };
    }
  }

  if (!args.text.includes("icm:Intent")) {
    return { text: args.text, changes: 0 };
  }

  if (!parsed) return { text: args.text, changes: 0 };

  let text = args.text;

  const hasDe = /data5g:DeploymentExpectation/.test(text);
  const hasSe = /data5g:SustainabilityExpectation/.test(text);
  const hasDataCenter = hasResolvedDataCenter(text);
  const needsScaffold =
    (needsDeployment && !hasDe) ||
    (needsSustainability && !hasSe) ||
    ((needsDeployment || needsSustainability) && parsed.dataCenter.length > 0 && !hasDataCenter);

  if (!needsScaffold) return { text, changes: 0 };

  let changes = 0;
  const intentLocal = findIntentLocal(text) ?? newLocal("I");
  const cxLocal = newLocal("CX");
  const blocks: string[] = [];
  const intentMembers: string[] = [];

  if (needsDeployment && !hasDe && parsed.deploymentObjectives.length > 0) {
    const deLocal = newLocal("DE");
    const coLocal = newLocal("CO");
    const reLocal = newLocal("RE");
    const durationLocal = `durationDeployment_${coLocal}`;
    const eventLocal = `SixtySecondReportEventDeployment_${coLocal}`;
    blocks.push(renderConditionBlock(coLocal, parsed.deploymentObjectives[0]));
    blocks.push(renderDeploymentExpectation(deLocal, coLocal, cxLocal, parsed.chartName));
    blocks.push(renderReportEvent(eventLocal, durationLocal, "Deployment", deLocal));
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
    const durationLocal = `durationSustainability_${anchorCo}`;
    const eventLocal = `SixtySecondReportEventSustainability_${anchorCo}`;
    blocks.push(renderSustainabilityExpectation(seLocal, coLocals, cxLocal));
    blocks.push(renderReportEvent(eventLocal, durationLocal, "Sustainability", seLocal));
    blocks.push(renderReportingExpectation(reLocal, "sustainability", eventLocal, detectReportStorage(text, args.context.runtimeContext ?? "")));
    intentMembers.push(seLocal, reLocal);
    changes += 1;
  }

  if (blocks.length === 0) return { text, changes: 0 };

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
