type JsonValue = unknown;

async function getJson(url: string): Promise<JsonValue> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

export class WorkloadCatalogueTool {
  constructor(private readonly baseUrl: string) {}

  async listCharts(): Promise<Array<Record<string, unknown>>> {
    const payload = await getJson(`${this.baseUrl.replace(/\/$/, "")}/api/charts`);
    if (Array.isArray(payload)) {
      return payload.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
    }
    if (payload && typeof payload === "object" && "charts" in payload) {
      const charts = (payload as Record<string, unknown>).charts;
      if (Array.isArray(charts)) {
        return charts.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
      }
    }
    return [];
  }

  async catalogueSummaryForLlm(maxEntries = 40): Promise<string> {
    const charts = await this.listCharts();
    if (charts.length === 0) return "No charts found in the workload catalogue.";
    return charts
      .slice(0, maxEntries)
      .map((chart) => {
        const name = String(chart.name ?? "<unknown>");
        const version = chart.version ? ` (version: ${String(chart.version)})` : "";
        const description = String(chart.description ?? "").trim();
        return `- ${name}${version}: ${description}`;
      })
      .join("\n");
  }

  async objectivesSummaryForChart(chartName: string): Promise<string> {
    const payload = await getJson(`${this.baseUrl.replace(/\/$/, "")}/api/charts/${encodeURIComponent(chartName)}`);
    const entries = Array.isArray(payload) ? payload : [payload];
    const lines = [`Selected chart: ${chartName}`];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const version = String((entry as Record<string, unknown>).version ?? "<unknown>");
      lines.push(`- version ${version}`);
    }
    return lines.join("\n");
  }
}
