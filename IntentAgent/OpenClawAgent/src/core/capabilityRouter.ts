import type { AppConfig } from "../config.js";
import type { ContextRules, LoadedDomainPackage } from "./packageLoader.js";
import type { IntentFlags } from "./workflowEngine.js";
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

export interface CapabilityContext {
  ontologySummary: string;
  exampleSummary: string;
  catalogueSummary: string;
  graphDbSummary: string;
  workflowOverride: string;
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

  private async createGraphDbApi(): Promise<GraphDbApi> {
    const mod = await this.importToolModule("graphdbTool.ts");
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

  async buildContext(userText: string, intentFlags: IntentFlags): Promise<CapabilityContext> {
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
    const ontology = await this.createOntologyApi();
    const catalogue = await this.createCatalogueApi();
    const graphdb = await this.createGraphDbApi();
    const locality = await this.createLocalityApi();

    if (capabilities.has("ontology_summary")) {
      ontologySummary = ontology.ontologySummary();
    }
    if (capabilities.has("example_summary")) {
      exampleSummary = ontology.exampleSummary();
    }
    if (capabilities.has("catalogue_summary")) {
      try {
        catalogueSummary = await catalogue.catalogueSummaryForLlm();
      } catch (error) {
        warnings.push("Workload catalogue lookup failed.");
        debug.push(`catalogue_lookup_error=${String(error)}`);
      }
    }

    if (capabilities.has("selected_workload_objectives")) {
      try {
        const selectedChart = await this.selectChart(userText, catalogue);
        if (selectedChart) {
          const objectivesSummary = await catalogue.objectivesSummaryForChart(selectedChart);
          catalogueSummary = `${catalogueSummary}\n\n${rules.prompts.selectedWorkloadTag}\n${objectivesSummary}\nUse these objective thresholds as deployment-condition defaults unless the user overrides.`;
        }
      } catch (error) {
        warnings.push("Selected workload objective extraction failed.");
        debug.push(`selected_workload_error=${String(error)}`);
      }
    }

    if (capabilities.has("graphdb_candidates")) {
      try {
        graphDbSummary = await this.graphDbSummary(userText, intentFlags, rules, debug, graphdb, locality);
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
          const turtle = await graphdb.getIntentTurtle(intentId);
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

    return {
      ontologySummary,
      exampleSummary,
      catalogueSummary,
      graphDbSummary,
      workflowOverride,
      warnings,
      debug
    };
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

  private async selectChart(userText: string, catalogue: CatalogueApi): Promise<string | null> {
    const charts = await catalogue.listCharts();
    const lowered = userText.toLowerCase();
    const normalizedQuery = lowered.replace(/[^a-z0-9]+/g, " ");
    const queryTokens = new Set(normalizedQuery.split(/\s+/).filter((token) => token.length >= 3));

    const names = [...new Set(charts.map((c) => String(c.name ?? "").trim()).filter(Boolean))].sort();
    for (const name of names) {
      if (lowered.includes(name.toLowerCase())) return name;
    }

    // Fallback: lexical score over chart name + description when user uses generic wording
    // (for example "small llm") instead of exact chart identifiers.
    let best: { name: string; score: number } | null = null;
    for (const chart of charts) {
      const name = String(chart.name ?? "").trim();
      if (!name) continue;
      const description = String(chart.description ?? "").trim();
      const haystack = `${name} ${description}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      const hayTokens = new Set(haystack.split(/\s+/).filter((token) => token.length >= 3));

      let score = 0;
      for (const token of queryTokens) {
        if (hayTokens.has(token)) {
          score += 2;
        } else if (haystack.includes(token)) {
          score += 1;
        }
      }
      if (queryTokens.has("llm") && /(^|[^a-z0-9])llm([^a-z0-9]|$)/.test(haystack)) {
        score += 3;
      }
      if (queryTokens.has("small") && /(small|mini|tiny|light)/.test(haystack)) {
        score += 1;
      }

      if (!best || score > best.score) {
        best = { name, score };
      }
    }
    if (best && best.score > 0) {
      return best.name;
    }
    return null;
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
