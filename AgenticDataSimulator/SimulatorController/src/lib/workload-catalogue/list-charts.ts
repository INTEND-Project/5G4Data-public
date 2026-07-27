import { resolveWorkloadCatalogBaseUrl } from "@/lib/workload-catalogue/resolve-base-url";

export type WorkloadCatalogEntry = {
  name: string;
  version?: string;
  description?: string;
};

function flattenChartsPayload(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object") as Array<
      Record<string, unknown>
    >;
  }

  if (payload && typeof payload === "object" && "charts" in payload) {
    const charts = (payload as Record<string, unknown>).charts;
    if (Array.isArray(charts)) {
      return charts.filter((item) => item && typeof item === "object") as Array<
        Record<string, unknown>
      >;
    }
  }

  if (payload && typeof payload === "object") {
    const flattened: Array<Record<string, unknown>> = [];
    for (const [chartName, versions] of Object.entries(payload as Record<string, unknown>)) {
      if (!Array.isArray(versions)) {
        continue;
      }
      for (const versionEntry of versions) {
        if (!versionEntry || typeof versionEntry !== "object") {
          continue;
        }
        flattened.push({ ...(versionEntry as Record<string, unknown>), name: chartName });
      }
    }
    return flattened;
  }

  return [];
}

function toWorkloadEntry(chart: Record<string, unknown>): WorkloadCatalogEntry | null {
  const name = typeof chart.name === "string" ? chart.name.trim() : "";
  if (!name) {
    return null;
  }

  const entry: WorkloadCatalogEntry = { name };
  if (typeof chart.version === "string" && chart.version.trim()) {
    entry.version = chart.version.trim();
  }
  if (typeof chart.description === "string" && chart.description.trim()) {
    entry.description = chart.description.trim();
  }
  return entry;
}

export function normalizeWorkloadCatalogCharts(payload: unknown): WorkloadCatalogEntry[] {
  const flattened = flattenChartsPayload(payload);
  const byName = new Map<string, WorkloadCatalogEntry>();

  for (const chart of flattened) {
    const entry = toWorkloadEntry(chart);
    if (!entry) {
      continue;
    }
    const existing = byName.get(entry.name);
    if (!existing) {
      byName.set(entry.name, entry);
      continue;
    }
    if (!existing.version && entry.version) {
      byName.set(entry.name, entry);
    }
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function listWorkloadCatalogCharts(
  workloadCatalogBaseUrl?: string | null,
): Promise<WorkloadCatalogEntry[]> {
  const baseUrl = resolveWorkloadCatalogBaseUrl(workloadCatalogBaseUrl);
  const response = await fetch(`${baseUrl}/api/charts`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Workload catalogue request failed (${response.status}).`);
  }

  const payload = (await response.json()) as unknown;
  return normalizeWorkloadCatalogCharts(payload);
}
