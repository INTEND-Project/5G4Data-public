import { formatIntervalLabel } from "./postprocess/reportingIntervalLabel.js";

export type ParsedChartInfo = {
  chartName: string;
  version: string;
};

export function parseChartInfo(runtimeContext: string): ParsedChartInfo | null {
  const match = runtimeContext.match(/Selected chart:\s*([^\s(]+)\s*\(version\s+([^)]+)\)/i);
  if (!match?.[1] || !match[2]) return null;
  return { chartName: match[1].trim(), version: match[2].trim() };
}

export function parseDataCenterFromGraphDb(runtimeContext: string): string | null {
  const binding = runtimeContext.match(
    /data5g:DataCenter\s+"([^"]+)"\s*\./i
  )?.[1];
  if (binding?.trim()) return binding.trim();
  const recommended = runtimeContext.match(
    /Recommended nearest edge data center:\s*(\S+)/i
  )?.[1];
  if (recommended?.trim()) return recommended.trim();
  const candidateLine = runtimeContext.match(
    /Candidate edge data centers from GraphDB:[\s\S]*?-\s*(EC_\d+)\s*\(/i
  )?.[1];
  if (candidateLine?.trim()) return candidateLine.trim();
  const candidate = runtimeContext.match(
    /Candidate edge data centers from GraphDB:\s*\n-\s*([^\s(]+)/i
  )?.[1];
  return candidate?.trim() || null;
}

export function resolveDataCenter(
  runtimeContext: string,
  selectedDataCenter?: string | null
): string | null {
  const explicit = selectedDataCenter?.trim();
  if (explicit) return explicit;
  return parseDataCenterFromGraphDb(runtimeContext);
}

export function parseReportingIntervalMinutes(
  reportingIntervalHint: string,
  fallback = 10
): number {
  const secondsMatch = reportingIntervalHint.match(/(\d+)\s+second/i);
  if (secondsMatch?.[1]) {
    const seconds = Number.parseInt(secondsMatch[1], 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(1, Math.round(seconds / 60));
    }
  }
  const minutesMatch = reportingIntervalHint.match(/(\d+)\s+minute/i);
  if (minutesMatch?.[1]) {
    const minutes = Number.parseInt(minutesMatch[1], 10);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }
  return fallback;
}

export function reportingEventLabel(minutes: number): string {
  return formatIntervalLabel(minutes);
}

export function buildDeploymentDescriptorUrl(
  runtimeContext: string,
  chart: ParsedChartInfo | null
): string {
  const explicit = runtimeContext.match(
    /DeploymentDescriptor\s+"([^"]+)"/i
  )?.[1];
  if (explicit?.trim()) return explicit.trim();
  if (!chart) return "https://start5g-1.cs.uit.no/wchartmuseum/api/charts/unknown";
  return `https://start5g-1.cs.uit.no/wchartmuseum/api/charts/${encodeURIComponent(chart.chartName)}/${encodeURIComponent(chart.version)}`;
}
