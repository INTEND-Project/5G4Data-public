/** Deterministic chart selection from natural-language prompt (same logic as create-intent context). */
export function selectChartFromCatalogue(
  userText: string,
  charts: Array<Record<string, unknown>>
): string | null {
  const lowered = userText.toLowerCase();
  const normalizedQuery = lowered.replace(/[^a-z0-9]+/g, " ");
  const queryTokens = new Set(normalizedQuery.split(/\s+/).filter((token) => token.length >= 3));

  const names = [...new Set(charts.map((c) => String(c.name ?? "").trim()).filter(Boolean))].sort();
  for (const name of names) {
    if (lowered.includes(name.toLowerCase())) return name;
  }

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
