export type WorkloadMetricEntry = {
  name?: string;
  value?: unknown;
  "tmf-value-hint"?: string;
  "tmf-quantifier-hint"?: string;
  "tmf-unit-hint"?: string;
  measuredBy?: string;
};

export type WorkloadPreviewMetrics = {
  selectedChart: string | null;
  version: string | null;
  objectives: WorkloadMetricEntry[];
  sustainability: WorkloadMetricEntry[];
  metricStems: string[];
  warnings: string[];
};

export type PreviewMetricsClientResult =
  | { ok: true; preview: WorkloadPreviewMetrics }
  | { ok: false; status: number; error: string };

export async function fetchWorkloadPreviewMetrics(args: {
  previewMetricsApiUrl: string;
  prompt: string;
  domain: string;
}): Promise<PreviewMetricsClientResult> {
  let response: Response;
  try {
    response = await fetch(args.previewMetricsApiUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: args.prompt,
        domain: args.domain,
      }),
    });
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }

  const body = (await response.json().catch(() => ({}))) as WorkloadPreviewMetrics & {
    error?: string;
  };

  if (!response.ok) {
    const message =
      typeof body.error === "string" && body.error.length > 0
        ? body.error
        : `Preview request failed (${response.status}).`;
    return { ok: false, status: response.status, error: message };
  }

  return {
    ok: true,
    preview: {
      selectedChart: body.selectedChart ?? null,
      version: body.version ?? null,
      objectives: Array.isArray(body.objectives) ? body.objectives : [],
      sustainability: Array.isArray(body.sustainability) ? body.sustainability : [],
      metricStems: Array.isArray(body.metricStems) ? body.metricStems : [],
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
    },
  };
}
