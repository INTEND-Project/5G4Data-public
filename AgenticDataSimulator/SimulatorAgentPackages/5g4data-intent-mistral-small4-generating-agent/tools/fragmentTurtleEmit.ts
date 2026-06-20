import type { ParsedCatalogueMetric } from "./parseCatalogueObjectives.js";

export function buildConditionBlock(metric: ParsedCatalogueMetric, coLocal: string): string {
  const unit = metric.unit || "1";
  const threshold = metric.threshold;
  const propLocal = `${metric.name}_${coLocal}`;
  const desc = `${metric.name} condition ${metric.quantifier}: ${threshold} ${unit}`;
  return `data5g:${coLocal} a icm:Condition ;
    dct:description "${desc.replace(/"/g, '\\"')}" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:${propLocal} ;
            ${metric.quantifier} [ quan:unit "${unit.replace(/"/g, '\\"')}" ;
                    rdf:value ${threshold} ] ] .`;
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
  const refs = [...args.coLocals, args.cxLocal].map((l) => `data5g:${l}`).join(",\n        ");
  return `data5g:${args.deLocal} a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:deployment ;
    log:allOf ${refs} .`;
}

export function buildSustainabilityExpectationBlock(args: {
  seLocal: string;
  coLocals: string[];
  cxLocal: string | null;
  intervalMinutes: number;
}): string {
  const members = [...args.coLocals, ...(args.cxLocal ? [args.cxLocal] : [])];
  const refs = members.map((l) => `data5g:${l}`).join(",\n        ");
  return `data5g:${args.seLocal} a data5g:SustainabilityExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:sustainability ;
    log:allOf ${refs} .`;
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

data5g:${eventLocal} a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:${durationLocal} ) ;
    imo:eventFor data5g:${args.expectationLocal} .

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
  quantifier: "quan:larger" | "quan:smaller";
}): string {
  const propLocal = `${args.stem}_${args.coLocal}`;
  const desc = `${args.stem} condition ${args.quantifier === "quan:larger" ? "larger" : "smaller"}: ${args.threshold} ${args.unit}`;
  return `data5g:${args.coLocal} a icm:Condition ;
    dct:description "${desc.replace(/"/g, '\\"')}" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:${propLocal} ;
            ${args.quantifier} [ quan:unit "${args.unit.replace(/"/g, '\\"')}" ;
                    rdf:value ${args.threshold} ] ] .`;
}

export function buildNetworkExpectationBlock(args: {
  neLocal: string;
  coLocals: string[];
  cxLocal: string | null;
}): string {
  const members = [...args.coLocals, ...(args.cxLocal ? [args.cxLocal] : [])];
  const refs = members.map((l) => `data5g:${l}`).join(",\n        ");
  return `data5g:${args.neLocal} a data5g:NetworkExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:network-slice ;
    log:allOf ${refs} .`;
}
