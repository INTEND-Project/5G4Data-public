import type { ParsedCatalogueMetric } from "./parseCatalogueObjectives.js";
import {
  formatConditionBlock,
  formatLogAllOf,
  formatReportEventBlock,
  rdfList
} from "./postprocess/tioDialect.js";

export function buildConditionBlock(metric: ParsedCatalogueMetric, coLocal: string): string {
  const unit = metric.unit || "1";
  const threshold = metric.threshold;
  const propLocal = `${metric.name}_${coLocal}`;
  const quantifier = metric.quantifier === "quan:larger" ? "quan:greater" : metric.quantifier;
  const desc = `${metric.name} condition ${quantifier}: ${threshold} ${unit}`;
  return formatConditionBlock({
    coLocal,
    description: desc,
    propLocal,
    quantifier,
    unit,
    threshold
  });
}

export function buildContextBlock(args: {
  cxLocal: string;
  application: string;
  dataCenter: string;
  deploymentDescriptor: string;
}): string {
  return `data5g:${args.cxLocal} a icm:Context ;
    data5g:Application "${args.application.replace(/"/g, '\\"')}" ;
    data5g:DataCenter "${args.dataCenter.replace(/"/g, '\\"')}" ;
    data5g:DeploymentDescriptor "${args.deploymentDescriptor.replace(/"/g, '\\"')}" .`;
}

export function buildDeploymentExpectationBlock(args: {
  deLocal: string;
  coLocals: string[];
  cxLocal: string;
  intervalMinutes: number;
}): string {
  const members = [...args.coLocals, args.cxLocal];
  return `data5g:${args.deLocal} a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:deployment ;
    ${formatLogAllOf(members)} .`;
}

export function buildSustainabilityExpectationBlock(args: {
  seLocal: string;
  coLocals: string[];
  cxLocal: string | null;
  intervalMinutes: number;
}): string {
  const members = [...args.coLocals, ...(args.cxLocal ? [args.cxLocal] : [])];
  return `data5g:${args.seLocal} a data5g:SustainabilityExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:sustainability ;
    ${formatLogAllOf(members)} .`;
}

export function buildScopedReportingBlocks(args: {
  scope: "deployment" | "sustainability" | "coordination" | "network";
  expectationLocal: string;
  reLocal: string;
  firstCoOrCeLocal: string;
  intervalMinutes: number;
  intervalLabel: string;
  description: string;
}): string {
  const durationPrefix =
    args.scope === "deployment"
      ? "durationDeployment"
      : args.scope === "sustainability"
        ? "durationSustainability"
        : args.scope === "network"
          ? "durationNetwork"
          : "durationCoordination";
  const eventPrefix =
    args.scope === "deployment"
      ? `${args.intervalLabel}ReportEventDeployment`
      : args.scope === "sustainability"
        ? `${args.intervalLabel}ReportEventSustainability`
        : args.scope === "network"
          ? `${args.intervalLabel}ReportEventNetwork`
          : `${args.intervalLabel}ReportEventCoordination`;
  const target =
    args.scope === "deployment"
      ? "data5g:deployment"
      : args.scope === "sustainability"
        ? "data5g:sustainability"
        : args.scope === "network"
          ? "data5g:network-slice"
          : "data5g:coordination-service";
  const durationLocal = `${durationPrefix}_${args.firstCoOrCeLocal}`;
  const eventLocal = `${eventPrefix}_${args.firstCoOrCeLocal}`;

  return `data5g:${durationLocal} a time:DurationDescription ;
    time:numericDuration "${args.intervalMinutes}"^^xsd:decimal ;
    time:unitType time:unitMinute .

${formatReportEventBlock({
  eventLocal,
  durationLocal,
  expectationLocal: args.expectationLocal
})}

data5g:${args.reLocal} a icm:ObservationReportingExpectation ;
    dct:description "${args.description.replace(/"/g, '\\"')}" ;
    icm:target ${target} ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:${eventLocal} ] .`;
}

export function buildNetworkConditionBlock(args: {
  stem: "bandwidth" | "latency";
  coLocal: string;
  threshold: number;
  unit: string;
  quantifier: "quan:larger" | "quan:greater" | "quan:smaller";
}): string {
  const propLocal = `${args.stem}_${args.coLocal}`;
  const quantifier = args.quantifier === "quan:larger" ? "quan:greater" : args.quantifier;
  const label = quantifier === "quan:greater" ? "greater" : "smaller";
  const desc = `${args.stem} condition ${label}: ${args.threshold} ${args.unit}`;
  return formatConditionBlock({
    coLocal: args.coLocal,
    description: desc,
    propLocal,
    quantifier,
    unit: args.unit,
    threshold: args.threshold
  });
}

export function buildNetworkExpectationBlock(args: {
  neLocal: string;
  coLocals: string[];
  cxLocal: string | null;
}): string {
  const members = [...args.coLocals, ...(args.cxLocal ? [args.cxLocal] : [])];
  return `data5g:${args.neLocal} a data5g:NetworkExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:network-slice ;
    ${formatLogAllOf(members)} .`;
}

export { rdfList };
