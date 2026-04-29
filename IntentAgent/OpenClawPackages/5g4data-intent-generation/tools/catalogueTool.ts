import { parse as parseYaml } from "yaml";
import { catalogueChartSchema } from "../models.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const FULL_CATALOG_LLM_MATCH_THRESHOLD = 50;

type JsonValue = unknown;
type Objective = Record<string, unknown>;

async function getJson(url: string): Promise<JsonValue> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractArrayField(node: unknown, fieldName: string): Objective[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = extractArrayField(child, fieldName);
      if (found.length > 0) return found;
    }
    return [];
  }
  if (node && typeof node === "object") {
    const dict = node as Record<string, unknown>;
    const candidate = dict[fieldName];
    if (Array.isArray(candidate) && candidate.every((item) => typeof item === "object")) {
      return candidate as Objective[];
    }
    for (const child of Object.values(dict)) {
      const found = extractArrayField(child, fieldName);
      if (found.length > 0) return found;
    }
  }
  return [];
}

function valuesPayloadToStructure(values: unknown): unknown {
  if (typeof values === "string") {
    const stripped = values.trim();
    if (!stripped) return null;
    try {
      return JSON.parse(stripped);
    } catch {
      try {
        return parseYaml(stripped);
      } catch {
        return null;
      }
    }
  }
  return values;
}

function extractMetricsFromValuesPayload(values: unknown, fieldName: "objectives" | "sustainability"): Objective[] {
  const structured = valuesPayloadToStructure(values);
  if (!structured) return [];
  return extractArrayField(structured, fieldName);
}

function objectivesFromValuesPayload(values: unknown): Objective[] {
  return extractMetricsFromValuesPayload(values, "objectives");
}

function sustainabilityFromValuesPayload(values: unknown): Objective[] {
  return extractMetricsFromValuesPayload(values, "sustainability");
}

export class WorkloadCatalogueTool {
  constructor(private readonly baseUrl: string) {}

  async listCharts(): Promise<Array<Record<string, unknown>>> {
    const payload = await getJson(`${this.baseUrl.replace(/\/$/, "")}/api/charts`);
    if (Array.isArray(payload)) {
      return payload
        .filter((item) => item && typeof item === "object")
        .map((item) => catalogueChartSchema.passthrough().parse(item));
    }
    if (payload && typeof payload === "object" && "charts" in payload) {
      const charts = (payload as Record<string, unknown>).charts;
      if (Array.isArray(charts)) {
        return charts
          .filter((item) => item && typeof item === "object")
          .map((item) => catalogueChartSchema.passthrough().parse(item));
      }
    }
    if (payload && typeof payload === "object") {
      const flattened: Array<Record<string, unknown>> = [];
      for (const [chartName, versions] of Object.entries(payload as Record<string, unknown>)) {
        if (!Array.isArray(versions)) continue;
        for (const versionEntry of versions) {
          if (!versionEntry || typeof versionEntry !== "object") continue;
          flattened.push({ ...(versionEntry as Record<string, unknown>), name: chartName });
        }
      }
      return flattened;
    }
    return [];
  }

  async catalogueSummaryForLlm(maxEntries = FULL_CATALOG_LLM_MATCH_THRESHOLD): Promise<string> {
    const charts = await this.listCharts();
    if (charts.length === 0) return "No charts found in the workload catalogue.";
    if (charts.length > maxEntries) {
      const names = charts
        .slice(0, maxEntries)
        .map((c) => String(c.name ?? "<unknown>"))
        .join(", ");
      return `Catalogue currently has ${charts.length} entries, exceeding full-catalog threshold ${maxEntries}. Shortlist mode is needed. First ${maxEntries} chart names: ${names}`;
    }
    return charts
      .map((chart) => {
        const name = String(chart.name ?? "<unknown>");
        const version = chart.version ? ` (version: ${String(chart.version)})` : "";
        const description = String(chart.description ?? "").trim();
        return `- ${name}${version}: ${description}`;
      })
      .join("\n");
  }

  async getChartVersions(name: string): Promise<unknown> {
    return getJson(`${this.baseUrl.replace(/\/$/, "")}/api/charts/${encodeURIComponent(name)}`);
  }

  async objectivesSummaryForChart(chartName: string): Promise<string> {
    const payload = await this.getChartVersions(chartName);
    const entries = Array.isArray(payload)
      ? payload.filter((item) => item && typeof item === "object")
      : payload && typeof payload === "object"
        ? [payload]
        : [];
    const sorted = [...entries].sort((a, b) =>
      String((b as Record<string, unknown>).version ?? "").localeCompare(
        String((a as Record<string, unknown>).version ?? "")
      )
    );
    for (const entry of sorted) {
      const e = entry as Record<string, unknown>;
      const version = String(e.version ?? "<unknown>").trim() || "<unknown>";
      let objectives = objectivesFromValuesPayload(e.values);
      let sustainability = sustainabilityFromValuesPayload(e.values);
      if ((objectives.length === 0 || sustainability.length === 0) && Array.isArray(e.urls)) {
        const archiveMetrics = await this.metricsFromArchiveUrls(
          e.urls.filter((url): url is string => typeof url === "string")
        );
        if (objectives.length === 0) objectives = archiveMetrics.objectives;
        if (sustainability.length === 0) sustainability = archiveMetrics.sustainability;
      }
      if (objectives.length === 0 && sustainability.length === 0) continue;
      const lines = [`Selected chart: ${chartName} (version ${version})`];
      if (objectives.length > 0) {
        lines.push("Deployment objective defaults from values.yaml objectives:");
        for (const objective of objectives) {
          const name = String(objective.name ?? "<unnamed>").trim();
          const hint = objective["tmf-value-hint"];
          const measuredBy = String(objective.measuredBy ?? "").trim();
          const threshold =
            hint !== undefined && String(hint).trim() !== ""
              ? String(hint).trim()
              : String(objective.value ?? "unspecified");
          const source = hint !== undefined && String(hint).trim() !== "" ? "tmf-value-hint" : "value";
          lines.push(`- ${name}: threshold=${threshold} (source=${source}${measuredBy ? `, measuredBy=${measuredBy}` : ""})`);
        }
      }
      if (sustainability.length > 0) {
        lines.push("Sustainability objective defaults from values.yaml sustainability:");
        for (const metric of sustainability) {
          const name = String(metric.name ?? "<unnamed>").trim();
          const hint = metric["tmf-value-hint"];
          const measuredBy = String(metric.measuredBy ?? "").trim();
          const threshold =
            hint !== undefined && String(hint).trim() !== ""
              ? String(hint).trim()
              : String(metric.value ?? "unspecified");
          const source = hint !== undefined && String(hint).trim() !== "" ? "tmf-value-hint" : "value";
          lines.push(`- ${name}: threshold=${threshold} (source=${source}${measuredBy ? `, measuredBy=${measuredBy}` : ""})`);
        }
      }
      return lines.join("\n");
    }
    return `Selected chart: ${chartName}. Could not extract deployment objectives or sustainability metrics from chart values.yaml. Ask for thresholds only if defaults cannot be retrieved.`;
  }

  private async metricsFromArchiveUrls(urls: string[]): Promise<{ objectives: Objective[]; sustainability: Objective[] }> {
    for (const url of urls) {
      try {
        const response = await fetch(url.startsWith("http") ? url : `${this.baseUrl}/${url.replace(/^\//, "")}`);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        const bytes = Buffer.from(arrayBuffer);
        const valuesContent = this.extractValuesYamlFromArchiveBytes(bytes);
        if (!valuesContent) continue;
        const objectives = objectivesFromValuesPayload(valuesContent);
        const sustainability = sustainabilityFromValuesPayload(valuesContent);
        if (objectives.length > 0 || sustainability.length > 0) return { objectives, sustainability };
      } catch {
        continue;
      }
    }
    return { objectives: [], sustainability: [] };
  }

  private extractValuesYamlFromArchiveBytes(archiveBytes: Buffer): string | null {
    const workDir = mkdtempSync(join(tmpdir(), "openclaw-chart-"));
    const archivePath = join(workDir, "chart.tgz");
    try {
      writeFileSync(archivePath, archiveBytes);
      const listing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.endsWith("/values.yaml"));
      const valuePath = listing[0];
      if (!valuePath) return null;
      const values = execFileSync("tar", ["-xOf", archivePath, valuePath], { encoding: "utf8" });
      return normalizeText(values).length > 0 ? values : null;
    } catch {
      return null;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}
