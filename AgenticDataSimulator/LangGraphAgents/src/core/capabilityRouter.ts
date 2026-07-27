import type { AppConfig } from "../config.js";
import type { GraphTargetBinding } from "../models.js";
import { traceToolCall } from "../tracing/langsmith.js";
import type { ContextRules, LoadedDomainPackage } from "./packageLoader.js";
import type { IntentFlags } from "./workflowEngine.js";
import { selectChartFromCatalogue } from "./workloadSelection.js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Coordinates {
  lat: number;
  lon: number;
}

type CatalogueApi = {
  listCharts: () => Promise<Array<Record<string, unknown>>>;
  catalogueSummaryForLlm: () => Promise<string>;
  objectivesSummaryForChart: (chartName: string) => Promise<string>;
  metricsForChart?: (chartName: string) => Promise<{
    chartName: string;
    version: string;
    objectives: Record<string, unknown>[];
    sustainability: Record<string, unknown>[];
  } | null>;
};

type GraphDbApi = {
  nearestEdgeCandidates: () => Promise<Array<Record<string, { value: string }>>>;
  getIntentTurtle?: (intentId: string) => Promise<string | null>;
};

type OntologyApi = {
  ontologySummary: () => string;
  exampleSummary: () => string;
};

type LocalityApi = {
  extractLocalityPhrase: (userText: string) => string | null;
  geocodePlace: (place: string) => Promise<Coordinates | null>;
  haversineKm: (lat1: number, lon1: number, lat2: number, lon2: number) => number;
  bboxPolygonWkt: (lat: number, lon: number, deltaDeg?: number) => string;
};

const NETWORK_QOS_PREVIEW_METRICS: Record<string, unknown>[] = [
  {
    name: "bandwidth",
    "tmf-quantifier-hint": "quan:larger",
    "tmf-unit-hint": "mbit/s",
  },
  {
    name: "latency",
    "tmf-quantifier-hint": "quan:smaller",
    "tmf-unit-hint": "ms",
  },
];

export interface WorkloadPreviewResult {
  selectedChart: string | null;
  version: string | null;
  objectives: Record<string, unknown>[];
  sustainability: Record<string, unknown>[];
  networkObjectives: Record<string, unknown>[];
  metricStems: string[];
  intentFlags: IntentFlags;
  warnings: string[];
}

export interface CapabilityContext {
  ontologySummary: string;
  exampleSummary: string;
  catalogueSummary: string;
  graphDbSummary: string;
  workflowOverride: string;
  knownMetricStems: string[];
  warnings: string[];
  debug: string[];
}

export class CapabilityRouter {
  constructor(
    private readonly config: AppConfig,
    private readonly domainPackage: LoadedDomainPackage
  ) {}

  private resolveToolCandidatePaths(fileName: string): string[] {
    const cloneToolPath = resolve(process.cwd(), "src", "tools", fileName);
    const packageToolPath = join(this.domainPackage.packageDir, "tools", fileName);
    return [cloneToolPath, packageToolPath];
  }

  private async importToolModule(fileName: string): Promise<Record<string, unknown>> {
    const candidates = this.resolveToolCandidatePaths(fileName);
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      const moduleUrl = pathToFileURL(candidate).href;
      const mod = (await import(moduleUrl)) as Record<string, unknown>;
      return mod;
    }
    throw new Error(`Tool module not found in clone or package: ${fileName}`);
  }

  private async createCatalogueApi(): Promise<CatalogueApi> {
    const mod = await this.importToolModule("catalogueTool.ts");
    const ToolCtor = mod.WorkloadCatalogueTool as new (baseUrl: string) => CatalogueApi;
    if (!ToolCtor) {
      throw new Error("catalogueTool.ts does not export WorkloadCatalogueTool.");
    }
    return new ToolCtor(this.config.workloadCatalogBaseUrl);
  }

  private graphDbEnvFallback() {
    return {
      graphDbEndpoint: this.config.graphDbEndpoint,
      graphDbNamedGraph: this.config.graphDbNamedGraph,
      graphDbInfraEndpoint: this.config.graphDbInfraEndpoint,
      graphDbInfraNamedGraph: this.config.graphDbInfraNamedGraph,
      graphDbQueryLimit: this.config.graphDbQueryLimit
    };
  }

  private async createGraphDbApi(
    graphTargetBinding?: GraphTargetBinding | null
  ): Promise<GraphDbApi> {
    const mod = await this.importToolModule("graphdbTool.ts");
    const fromBinding = mod.GraphDbTool as {
      fromBinding?: (
        binding: GraphTargetBinding | null | undefined,
        fallback: { graphDbEndpoint: string; graphDbNamedGraph: string; graphDbQueryLimit: number },
        queryLimit?: number
      ) => GraphDbApi;
    };
    if (typeof fromBinding.fromBinding === "function") {
      return fromBinding.fromBinding(graphTargetBinding, this.graphDbEnvFallback());
    }
    const ToolCtor = mod.GraphDbTool as new (
      endpoint: string,
      namedGraph: string,
      queryLimit: number
    ) => GraphDbApi;
    if (!ToolCtor) {
      throw new Error("graphdbTool.ts does not export GraphDbTool.");
    }
    return new ToolCtor(
      this.config.graphDbEndpoint,
      this.config.graphDbNamedGraph,
      this.config.graphDbQueryLimit
    );
  }

  /** Infra KG (`telenor-infrastructure-5g4data` / `http://intendproject.eu/telenor/infra`), not persist target. */
  private async createInfrastructureGraphDbApi(): Promise<GraphDbApi> {
    const mod = await this.importToolModule("graphdbTool.ts");
    const forInfra = mod.GraphDbTool as {
      forInfrastructureLookup?: (
        fallback: {
          graphDbEndpoint: string;
          graphDbNamedGraph: string;
          graphDbInfraEndpoint: string;
          graphDbInfraNamedGraph: string;
          graphDbQueryLimit: number;
        },
        queryLimit?: number
      ) => GraphDbApi;
    };
    if (typeof forInfra.forInfrastructureLookup === "function") {
      return forInfra.forInfrastructureLookup(this.graphDbEnvFallback());
    }
    const ToolCtor = mod.GraphDbTool as new (
      endpoint: string,
      namedGraph: string,
      queryLimit: number
    ) => GraphDbApi;
    return new ToolCtor(
      this.config.graphDbInfraEndpoint,
      this.config.graphDbInfraNamedGraph,
      this.config.graphDbQueryLimit
    );
  }

  private async createOntologyApi(): Promise<OntologyApi> {
    const mod = await this.importToolModule("ontologyTool.ts");
    const ToolCtor = mod.OntologyTool as new (
      ontologyRoot?: string,
      exampleIntentsRoot?: string
    ) => OntologyApi;
    if (!ToolCtor) {
      throw new Error("ontologyTool.ts does not export OntologyTool.");
    }
    return new ToolCtor(process.env.ONTOLOGY_ROOT, process.env.EXAMPLE_INTENTS_ROOT);
  }

  private async createLocalityApi(): Promise<LocalityApi> {
    const mod = await this.importToolModule("localityTool.ts");
    const extractLocalityPhrase = mod.extractLocalityPhrase as LocalityApi["extractLocalityPhrase"];
    const geocodePlace = mod.geocodePlace as LocalityApi["geocodePlace"];
    const haversineKm = mod.haversineKm as LocalityApi["haversineKm"];
    const bboxPolygonWkt = mod.bboxPolygonWkt as LocalityApi["bboxPolygonWkt"];
    if (!extractLocalityPhrase || !geocodePlace || !haversineKm || !bboxPolygonWkt) {
      throw new Error("localityTool.ts exports are incomplete.");
    }
    return { extractLocalityPhrase, geocodePlace, haversineKm, bboxPolygonWkt };
  }

  async buildContext(
    userText: string,
    intentFlags: IntentFlags,
    graphTargetBinding?: GraphTargetBinding | null
  ): Promise<CapabilityContext> {
    const warnings: string[] = [];
    const debug: string[] = [];
    const rules: ContextRules = this.domainPackage.contextRules;

    const capabilities = new Set(rules.baseCapabilities);
    for (const [flag, capList] of Object.entries(rules.intentCapabilities)) {
      if (intentFlags[flag]) {
        for (const capability of capList) capabilities.add(capability);
      }
    }

    let ontologySummary = "Ontology summary not requested.";
    let exampleSummary = "Example summary not requested.";
    let catalogueSummary = "Catalogue context not requested.";
    let graphDbSummary = "GraphDB context not requested.";
    let workflowOverride = "No workflow override.";
    let knownMetricStems: string[] = [];
    const ontology = await this.createOntologyApi();
    const catalogue = await this.createCatalogueApi();
    const graphdb = await this.createGraphDbApi(graphTargetBinding);
    const infraGraphdb = await this.createInfrastructureGraphDbApi();
    const locality = await this.createLocalityApi();

    if (graphTargetBinding) {
      graphDbSummary = `[Controller graph target] repository=${graphTargetBinding.repositoryId} graph=${graphTargetBinding.graphIri}`;
    }

    if (capabilities.has("ontology_summary")) {
      ontologySummary = ontology.ontologySummary();
    }
    if (capabilities.has("example_summary")) {
      exampleSummary = ontology.exampleSummary();
    }
    if (capabilities.has("catalogue_summary")) {
      try {
        catalogueSummary = await traceToolCall("catalogue_lookup", {}, () =>
          catalogue.catalogueSummaryForLlm()
        );
      } catch (error) {
        catalogueSummary = `[catalogue lookup failed] ${String(error)}`;
        warnings.push("Workload catalogue lookup failed.");
        debug.push(`catalogue_lookup_error=${String(error)}`);
      }
    }

    if (capabilities.has("selected_workload_objectives")) {
      try {
        const selectedChart = await traceToolCall("catalogue_select_chart", {}, () =>
          this.selectChart(userText, catalogue)
        );
        if (selectedChart) {
          const objectivesSummary = await catalogue.objectivesSummaryForChart(selectedChart);
          knownMetricStems = await this.parseMetricStemsFromObjectivesSummary(objectivesSummary);
          catalogueSummary = `${catalogueSummary}\n\n${rules.prompts.selectedWorkloadTag}\n${objectivesSummary}\nUse these objective thresholds, quantifiers, and units as deployment-condition defaults unless the user overrides.`;
          debug.push(`selected_workload_chart=${selectedChart}`);
          debug.push(`known_metric_stems=${knownMetricStems.join(",")}`);
          if (knownMetricStems.length === 0) {
            warnings.push(
              `Selected chart "${selectedChart}" but could not extract deployment/sustainability objectives from values.yaml.`,
            );
            catalogueSummary = `${catalogueSummary}\n\n[catalogue values.yaml extraction failed] Chart "${selectedChart}" was selected but objectives/sustainability metrics could not be read. Do not invent workload metrics; ask the user to specify another chart or retry catalogue lookup.`;
          }
        } else {
          const selectionFailed =
            "[catalogue workload selection failed] No matching workload chart found for this prompt. Ask the user to name a chart/version or say they want an automatic catalogue lookup (for example: lookup a suitable LLM workload).";
          catalogueSummary = `${catalogueSummary}\n\n${selectionFailed}`;
          warnings.push("No matching workload chart found in catalogue for this prompt.");
          debug.push("selected_workload_chart=null");
        }
      } catch (error) {
        catalogueSummary = `${catalogueSummary}\n\n[catalogue workload selection error] ${String(error)}`;
        warnings.push("Selected workload objective extraction failed.");
        debug.push(`selected_workload_error=${String(error)}`);
      }
    }

    const needsCatalogueWorkload = intentFlags.deployment || intentFlags.sustainability;
    const hasSelectedWorkload = catalogueSummary.includes(rules.prompts.selectedWorkloadTag);
    if (needsCatalogueWorkload && capabilities.has("selected_workload_objectives") && !hasSelectedWorkload) {
      workflowOverride =
        "Deployment or sustainability was requested but no [selected workload objectives] block is available from the catalogue. Do not generate Turtle. Explain the catalogue failure and ask the user to name a chart/version or request automatic workload lookup.";
    }

    if (capabilities.has("graphdb_candidates")) {
      try {
        graphDbSummary = await traceToolCall("graphdb_locality", { intentFlags }, () =>
          this.graphDbSummary(userText, intentFlags, rules, debug, infraGraphdb, locality)
        );
      } catch (error) {
        warnings.push("GraphDB lookup failed.");
        graphDbSummary = `GraphDB lookup failed: ${String(error)}`;
      }
    }

    if (capabilities.has("intent_turtle")) {
      const intentId = this.extractIntentId(userText);
      if (!intentId) {
        warnings.push("No intent_id found in input. Provide intent_id=<id> to load intent details.");
      } else if (typeof graphdb.getIntentTurtle === "function") {
        try {
          const turtle = await traceToolCall("graphdb_intent_load", { intentId }, () =>
            graphdb.getIntentTurtle!(intentId)
          );
          if (turtle && turtle.trim().length > 0) {
            graphDbSummary = `${graphDbSummary}\n\n[Intent Turtle for ${intentId}]\n${turtle}`;
            const metricSummary = await this.extractObservationMetricSummary(turtle);
            if (metricSummary) {
              graphDbSummary = `${graphDbSummary}\n\n[Observation Metrics]\n${metricSummary}`;
            }
            debug.push(`intent_turtle_loaded=true intent_id=${intentId}`);
          } else {
            warnings.push(`Could not retrieve Turtle for intent_id=${intentId}.`);
            debug.push(`intent_turtle_loaded=false intent_id=${intentId}`);
          }
        } catch (error) {
          warnings.push(`Intent lookup failed for intent_id=${intentId}.`);
          debug.push(`intent_turtle_error=${String(error)}`);
        }
      }
    }

    if (intentFlags.deployment && !intentFlags.locality) {
      workflowOverride =
        "Deployment request detected without explicit locality cue. Clarify default datacenter vs user geolocation hint before final Turtle.";
    }

    knownMetricStems = this.mergeMetricStemsWithNetwork(knownMetricStems, intentFlags);

    return {
      ontologySummary,
      exampleSummary,
      catalogueSummary,
      graphDbSummary,
      workflowOverride,
      knownMetricStems,
      warnings,
      debug
    };
  }

  async resolveWorkloadPreview(
    userText: string,
    intentFlags: IntentFlags,
    _graphTargetBinding?: GraphTargetBinding | null
  ): Promise<WorkloadPreviewResult> {
    const warnings: string[] = [];
    const rules: ContextRules = this.domainPackage.contextRules;
    const capabilities = new Set(rules.baseCapabilities);
    for (const [flag, capList] of Object.entries(rules.intentCapabilities)) {
      if (intentFlags[flag]) {
        for (const capability of capList) capabilities.add(capability);
      }
    }

    if (!capabilities.has("selected_workload_objectives")) {
      return this.finalizeWorkloadPreview(
        {
          selectedChart: null,
          version: null,
          objectives: [],
          sustainability: [],
          metricStems: [],
          warnings: [
            "Prompt does not imply deployment or sustainability; no catalogue workload selection performed.",
          ],
        },
        intentFlags
      );
    }

    try {
      const catalogue = await this.createCatalogueApi();
      const selectedChart = await this.selectChart(userText, catalogue);
      if (!selectedChart) {
        return this.finalizeWorkloadPreview(
          {
            selectedChart: null,
            version: null,
            objectives: [],
            sustainability: [],
            metricStems: [],
            warnings: ["No matching workload chart found in catalogue for this prompt."],
          },
          intentFlags
        );
      }

      if (typeof catalogue.metricsForChart === "function") {
        const metrics = await catalogue.metricsForChart(selectedChart);
        if (metrics) {
          const metricStems = this.metricStemsFromEntries(
            metrics.objectives,
            metrics.sustainability
          );
          return this.finalizeWorkloadPreview(
            {
              selectedChart: metrics.chartName,
              version: metrics.version,
              objectives: metrics.objectives,
              sustainability: metrics.sustainability,
              metricStems,
              warnings,
            },
            intentFlags
          );
        }
      }

      const objectivesSummary = await catalogue.objectivesSummaryForChart(selectedChart);
      const metricStems = await this.parseMetricStemsFromObjectivesSummary(objectivesSummary);
      return this.finalizeWorkloadPreview(
        {
          selectedChart,
          version: null,
          objectives: [],
          sustainability: [],
          metricStems,
          warnings: warnings.length
            ? warnings
            : ["Could not extract structured metrics from selected chart values.yaml."],
        },
        intentFlags
      );
    } catch (error) {
      warnings.push("Selected workload objective extraction failed.");
      return this.finalizeWorkloadPreview(
        {
          selectedChart: null,
          version: null,
          objectives: [],
          sustainability: [],
          metricStems: [],
          warnings: [...warnings, String(error)],
        },
        intentFlags
      );
    }
  }

  private finalizeWorkloadPreview(
    preview: {
      selectedChart: string | null;
      version: string | null;
      objectives: Record<string, unknown>[];
      sustainability: Record<string, unknown>[];
      metricStems: string[];
      warnings: string[];
    },
    intentFlags: IntentFlags
  ): WorkloadPreviewResult {
    const networkObjectives = intentFlags.networkQos ? [...NETWORK_QOS_PREVIEW_METRICS] : [];
    const metricStems = this.mergeMetricStemsWithNetwork(preview.metricStems, intentFlags);
    return {
      ...preview,
      networkObjectives,
      metricStems,
      intentFlags,
    };
  }

  private mergeMetricStemsWithNetwork(metricStems: string[], intentFlags: IntentFlags): string[] {
    const stems = new Set(metricStems);
    if (intentFlags.networkQos) {
      stems.add("bandwidth");
      stems.add("latency");
    }
    return [...stems].sort();
  }

  private metricStemsFromEntries(
    objectives: Record<string, unknown>[],
    sustainability: Record<string, unknown>[]
  ): string[] {
    const stems = new Set<string>();
    for (const entry of [...objectives, ...sustainability]) {
      const name = String(entry.name ?? "").trim();
      if (name) stems.add(name);
    }
    return [...stems].sort();
  }

  private async graphDbSummary(
    userText: string,
    intentFlags: IntentFlags,
    rules: ContextRules,
    debug: string[],
    graphdb: GraphDbApi,
    locality: LocalityApi
  ): Promise<string> {
    const bindings = await graphdb.nearestEdgeCandidates();
    if (bindings.length === 0) {
      return "GraphDB query returned no candidate data centers.";
    }
    const placeQuery = locality.extractLocalityPhrase(userText);
    let ranked = [...bindings];
    let geocode: Coordinates | null = null;
    if (placeQuery) {
      geocode = await locality.geocodePlace(placeQuery);
      if (geocode) {
        const g = geocode;
        ranked.sort((a, b) => {
          const latA = Number(a.lat?.value ?? "0");
          const lonA = Number(a.long?.value ?? "0");
          const latB = Number(b.lat?.value ?? "0");
          const lonB = Number(b.long?.value ?? "0");
          return (
            locality.haversineKm(g.lat, g.lon, latA, lonA) -
            locality.haversineKm(g.lat, g.lon, latB, lonB)
          );
        });
      }
    }
    const first = ranked[0];
    const selectedCandidate =
      first?.clusterId?.value ?? first?.location?.value ?? first?.datacenter?.value ?? "";
    const formatted = ranked
      .slice(0, this.config.graphDbContextLimit)
      .map(
        (b) =>
          `- ${b.clusterId?.value ?? b.location?.value ?? b.datacenter?.value ?? "<unknown>"} (${b.lat?.value ?? ""}, ${b.long?.value ?? ""})`
      )
      .join("\n");
    let summary = `Recommended nearest edge data center: ${selectedCandidate}\nCandidate edge data centers from GraphDB:\n${formatted}`;
    if (selectedCandidate) {
      summary += `\n\n[Deployment locality binding]\nFor any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "${selectedCandidate}" .\``;
    }
    if (intentFlags.deployment && !placeQuery && selectedCandidate) {
      summary += `\n\n${rules.prompts.deploymentDatacenterClarificationTag}\nDeployment requested without geolocation hint. Ask one concise question to use "${selectedCandidate}" by default or provide place hint.`;
    }
    if (intentFlags.locality && geocode) {
      summary += `\n\n[Network expectation geographic context]\nUse dedicated network context with data5g:appliesToRegion and geo:asWKT.\n"${locality.bboxPolygonWkt(geocode.lat, geocode.lon)}"^^geo:wktLiteral`;
    }
    debug.push(`graphdb_candidates_count=${bindings.length}`);
    return summary;
  }


  private async parseMetricStemsFromObjectivesSummary(summary: string): Promise<string[]> {
    try {
      const mod = await this.importToolModule("metricNaming.ts");
      const parse = mod.parseMetricStemsFromRuntimeContext as ((runtimeContext: string) => string[]) | undefined;
      if (!parse) return [];
      return parse(summary);
    } catch {
      return [];
    }
  }

  private async selectChart(userText: string, catalogue: CatalogueApi): Promise<string | null> {
    const charts = await catalogue.listCharts();
    return selectChartFromCatalogue(userText, charts);
  }

  private extractIntentId(userText: string): string | null {
    const explicit = /intent[_\s-]*id\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(userText)?.[1];
    if (explicit) return explicit;
    const bare = /\b(I[a-fA-F0-9]{32})\b/.exec(userText)?.[1];
    return bare ?? null;
  }

  private async extractObservationMetricSummary(intentTurtle: string): Promise<string | null> {
    try {
      const mod = await this.importToolModule("observationTool.ts");
      const ToolCtor = mod.ObservationTool as new () => { metricsSummary: (ttl: string) => string };
      if (!ToolCtor) return null;
      const tool = new ToolCtor();
      return tool.metricsSummary(intentTurtle);
    } catch {
      return null;
    }
  }
}
