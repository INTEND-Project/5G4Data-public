const conditionSuffixPattern = /_CO[a-f0-9]+$/i;

export function extractMetricCatalog(metricPropertyNames: string[]) {
  return Array.from(
    new Set(
      metricPropertyNames.map((metricName) => metricName.replace(conditionSuffixPattern, "")),
    ),
  );
}
