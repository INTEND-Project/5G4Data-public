export type ParsedCatalogueMetric = {
  name: string;
  threshold: string;
  quantifier: string;
  unit: string;
};

const METRIC_LINE_RE =
  /^- ([^:]+):\s*threshold=([^\s,(]+)(?:\s*\([^)]*\))?(?:,\s*quantifier=(quan:\w+)(?:\s*\([^)]*\))?)?(?:,\s*unit=([^\s,(]+)(?:\s*\([^)]*\))?)?/;

function parseMetricLine(line: string): ParsedCatalogueMetric | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;
  const match = trimmed.match(METRIC_LINE_RE);
  if (!match?.[1] || !match[2]) return null;
  return {
    name: match[1].trim(),
    threshold: match[2].trim(),
    quantifier: match[3]?.trim() || "quan:larger",
    unit: match[4]?.trim() || ""
  };
}

function sectionLines(runtimeContext: string, header: string): string[] {
  const idx = runtimeContext.indexOf(header);
  if (idx < 0) return [];
  const after = runtimeContext.slice(idx + header.length);
  const nextHeader = after.search(
    /\n(?:Deployment objective|Sustainability objective|\[GraphDB\]|\[Workflow)/i
  );
  const body = nextHeader >= 0 ? after.slice(0, nextHeader) : after;
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

export function parseDeploymentObjectives(runtimeContext: string): ParsedCatalogueMetric[] {
  const lines = sectionLines(
    runtimeContext,
    "Deployment objective defaults from values.yaml objectives:"
  );
  return lines.map(parseMetricLine).filter((m): m is ParsedCatalogueMetric => m !== null);
}

export function parseSustainabilityObjectives(runtimeContext: string): ParsedCatalogueMetric[] {
  const lines = sectionLines(
    runtimeContext,
    "Sustainability objective defaults from values.yaml sustainability:"
  );
  return lines.map(parseMetricLine).filter((m): m is ParsedCatalogueMetric => m !== null);
}
