import type { AppConfig } from "../config.js";
import { GraphDbTool } from "../tools/graphdbTool.js";
import { bboxPolygonWkt, extractLocalityPhrase, geocodePlace, haversineKm } from "../tools/localityTool.js";
import { OntologyTool } from "../tools/ontologyTool.js";
import { WorkloadCatalogueTool } from "../tools/catalogueTool.js";
import type { Coordinates } from "../tools/localityTool.js";
import {
  buildToolContext,
  deploymentLookupInstruction,
  requestImpliesDeployment,
  requestImpliesLocality
} from "../utils/prompting.js";

export interface RuntimeContextResult {
  runtimeContext: string;
  warnings: string[];
  debug: string[];
  selectedChart: string | null;
}

export class RuntimeContextBuilder {
  private readonly catalogue: WorkloadCatalogueTool;
  private readonly graphdb: GraphDbTool;
  private readonly ontology: OntologyTool;

  constructor(private readonly config: AppConfig) {
    this.catalogue = new WorkloadCatalogueTool(config.workloadCatalogBaseUrl);
    this.graphdb = new GraphDbTool(config.graphDbEndpoint, config.graphDbNamedGraph, config.graphDbQueryLimit);
    this.ontology = new OntologyTool(process.env.ONTOLOGY_ROOT, process.env.EXAMPLE_INTENTS_ROOT);
  }

  async build(userText: string): Promise<RuntimeContextResult> {
    const warnings: string[] = [];
    const debug: string[] = [];
    const ontologySummary = this.ontology.ontologySummary();
    const exampleSummary = this.ontology.exampleSummary();

    let catalogueSummary = "No charts found in the workload catalogue.";
    let fullCatalogMode = false;
    let selectedChart: string | null = null;
    try {
      catalogueSummary = await this.catalogue.catalogueSummaryForLlm();
      fullCatalogMode = !catalogueSummary.includes("Shortlist mode is needed");
      selectedChart = await this.selectChart(userText);
      if (selectedChart) {
        const objectivesSummary = await this.catalogue.objectivesSummaryForChart(selectedChart);
        catalogueSummary = `${catalogueSummary}

[Selected workload objectives]
${objectivesSummary}
Use these objective thresholds as deployment-condition defaults unless the user overrides.`;
      }
    } catch (error) {
      warnings.push("Workload catalogue lookup failed.");
      debug.push(`catalogue_lookup_error=${String(error)}`);
    }

    const deploymentNeeded = Boolean(selectedChart) || requestImpliesDeployment(userText);
    const localityNeeded = requestImpliesLocality(userText);
    const graphdbNeeded = deploymentNeeded || localityNeeded;

    let graphDbSummary = "GraphDB lookup not required for this turn.";
    if (graphdbNeeded) {
      try {
        const bindings = await this.graphdb.nearestEdgeCandidates();
        if (bindings.length === 0) {
          graphDbSummary = "GraphDB query returned no candidate data centers.";
        } else {
          const placeQuery = extractLocalityPhrase(userText);
          let ranked = [...bindings];
          let selectedCandidate = "";
          let geocode: Coordinates | null = null;
          if (placeQuery) {
            geocode = await geocodePlace(placeQuery);
            if (geocode) {
              const g = geocode;
              ranked.sort((a, b) => {
                const latA = Number(a.lat?.value ?? "0");
                const lonA = Number(a.long?.value ?? "0");
                const latB = Number(b.lat?.value ?? "0");
                const lonB = Number(b.long?.value ?? "0");
                return (
                  haversineKm(g.lat, g.lon, latA, lonA) -
                  haversineKm(g.lat, g.lon, latB, lonB)
                );
              });
            }
          }
          const first = ranked[0];
          selectedCandidate =
            first?.clusterId?.value ?? first?.location?.value ?? first?.datacenter?.value ?? "";
          const formatted = ranked
            .slice(0, this.config.graphDbContextLimit)
            .map((b) => `- ${b.clusterId?.value ?? b.location?.value ?? b.datacenter?.value ?? "<unknown>"} (${b.lat?.value ?? ""}, ${b.long?.value ?? ""})`)
            .join("\n");
          graphDbSummary = `Recommended nearest edge data center: ${selectedCandidate}
Candidate edge data centers from GraphDB:
${formatted}`;
          if (selectedCandidate) {
            graphDbSummary += `

[Deployment locality binding]
For any locality-aware DeploymentExpectation in this turn, use exactly \`data5g:DataCenter "${selectedCandidate}" .\``;
          }
          if (deploymentNeeded && !placeQuery && selectedCandidate) {
            graphDbSummary += `

[Deployment datacenter clarification required]
Deployment requested without geolocation hint. Ask one concise question to use "${selectedCandidate}" by default or provide place hint.`;
          }
          if (placeQuery && geocode) {
            graphDbSummary += `

[Network expectation geographic context]
Use a dedicated network context with data5g:appliesToRegion and geo:asWKT.
Approximate region WKT:
"${bboxPolygonWkt(geocode.lat, geocode.lon)}"^^geo:wktLiteral`;
          }
        }
      } catch (error) {
        warnings.push("GraphDB lookup failed.");
        graphDbSummary = `GraphDB lookup failed: ${String(error)}`;
      }
    }

    const workflowOverride = deploymentLookupInstruction(deploymentNeeded, catalogueSummary, fullCatalogMode);
    const runtimeContext = buildToolContext({
      ontologySummary,
      exampleSummary,
      catalogueSummary,
      graphDbSummary,
      workflowOverride
    });

    return { runtimeContext, warnings, debug, selectedChart };
  }

  private async selectChart(userText: string): Promise<string | null> {
    const charts = await this.catalogue.listCharts();
    const names = [...new Set(charts.map((c) => String(c.name ?? "").trim()).filter(Boolean))].sort();
    const lowered = userText.toLowerCase();
    for (const name of names) {
      if (lowered.includes(name.toLowerCase())) return name;
    }
    // Semantic matching is delegated to model in turn orchestrator; here we preserve deterministic baseline.
    return null;
  }
}
