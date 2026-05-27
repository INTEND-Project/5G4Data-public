export type FetchIntentMetricCatalogResult =
  | { ok: true; metricNames: string[] }
  | { ok: false; status: number; error: string };

export async function fetchIntentMetricCatalog(args: {
  kgTargetsApiBaseUrl: string;
  kgTargetId: string;
  intentLocalId: string;
}): Promise<FetchIntentMetricCatalogResult> {
  const base = args.kgTargetsApiBaseUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(args.kgTargetId)}/metric-catalog`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentLocalId: args.intentLocalId }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    return { ok: false, status: 0, error: message };
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    metricNames?: string[];
  };

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        typeof data.error === "string" && data.error.length > 0
          ? data.error
          : `HTTP ${response.status}`,
    };
  }

  const metricNames = Array.isArray(data.metricNames) ? data.metricNames : [];
  return { ok: true, metricNames };
}
