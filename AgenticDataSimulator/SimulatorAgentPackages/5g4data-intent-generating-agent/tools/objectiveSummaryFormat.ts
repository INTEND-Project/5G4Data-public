type Objective = Record<string, unknown>;

function trimmedField(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/** Format one objectives/sustainability entry for LLM runtime context. */
export function formatMetricSummaryLine(metric: Objective): string {
  const name = String(metric.name ?? "<unnamed>").trim();
  const valueHint = metric["tmf-value-hint"];
  const threshold =
    valueHint !== undefined && String(valueHint).trim() !== ""
      ? String(valueHint).trim()
      : String(metric.value ?? "unspecified");
  const thresholdSource =
    valueHint !== undefined && String(valueHint).trim() !== "" ? "tmf-value-hint" : "value";

  const parts = [`- ${name}: threshold=${threshold} (source=${thresholdSource})`];

  const quantifierHint = trimmedField(metric["tmf-quantifier-hint"]);
  if (quantifierHint) {
    parts.push(`quantifier=${quantifierHint} (source=tmf-quantifier-hint)`);
  }

  const unitHint = trimmedField(metric["tmf-unit-hint"]);
  if (unitHint) {
    parts.push(`unit=${unitHint} (source=tmf-unit-hint)`);
  }

  const measuredBy = trimmedField(metric.measuredBy);
  if (measuredBy) {
    parts.push(`measuredBy=${measuredBy}`);
  }

  return parts.join(", ");
}
