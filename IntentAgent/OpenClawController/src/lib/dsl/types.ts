export type DslDiagnostic = {
  line: number;
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type DiscoverStatement = {
  kind: "discover";
  line: number;
  agentKind: "intent-agent" | "status-agent" | "observation-agent";
  domain: string;
  alias: string;
};

export type CreateIntentStatement = {
  kind: "create-intent";
  line: number;
  agentAlias: string;
  prompt: string;
  intentAlias: string;
};

export type ExtractMetricCatalogStatement = {
  kind: "extract-metric-catalog";
  line: number;
  intentAlias: string;
  metricCatalogAlias: string;
};

export type RequestStatusReportStatement = {
  kind: "request-status-report";
  line: number;
  agentAlias: string;
  intentAlias: string;
  instructions: string;
  sessionAlias: string;
};

export type RequestObservationReportStatement = {
  kind: "request-observation-report";
  line: number;
  agentAlias: string;
  intentAlias: string;
  instructions: string;
  sessionAlias: string;
};

export type DslStatement =
  | DiscoverStatement
  | CreateIntentStatement
  | ExtractMetricCatalogStatement
  | RequestStatusReportStatement
  | RequestObservationReportStatement;
