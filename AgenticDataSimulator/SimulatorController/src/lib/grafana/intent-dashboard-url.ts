import { loadAppEnv } from "@/lib/env";
import {
  historicGrafanaWindow,
  isStreamingBounds,
  type ObservationTimeBounds,
} from "@/lib/intents/observation-time-bounds";

export type GrafanaDashboardEnv = {
  baseUrl: string | null;
  dashboardUid: string;
  dashboardSlug: string;
};

export function grafanaDashboardEnvFromProcess(
  source: Partial<Record<string, string | undefined>> = process.env,
): GrafanaDashboardEnv {
  const parsed = loadAppEnv(source);
  return {
    baseUrl: parsed.grafanaBaseUrl ?? null,
    dashboardUid: parsed.grafanaTimeseriesDashboardUid,
    dashboardSlug: parsed.grafanaTimeseriesDashboardSlug,
  };
}

export function buildGrafanaTimeParams(bounds: ObservationTimeBounds | null): {
  from: string;
  to: string;
} {
  if (!bounds || isStreamingBounds(bounds)) {
    return { from: "now-3h", to: "now" };
  }

  const window = historicGrafanaWindow(bounds);
  return {
    from: String(window.fromMs),
    to: String(window.toMs),
  };
}

export function buildIntentGrafanaUrl(input: {
  intentId: string;
  conditionMetrics: string[];
  bounds: ObservationTimeBounds | null;
  env?: GrafanaDashboardEnv;
}): string | null {
  const env = input.env ?? grafanaDashboardEnvFromProcess();
  if (!env.baseUrl) {
    return null;
  }

  const base = env.baseUrl.replace(/\/$/, "");
  const time = buildGrafanaTimeParams(input.bounds);
  const params = new URLSearchParams({
    "var-intent_id": input.intentId,
    from: time.from,
    to: time.to,
  });

  if (input.conditionMetrics.length > 0) {
    params.set("var-condition_metrics", input.conditionMetrics.join(","));
  }

  return `${base}/d/${encodeURIComponent(env.dashboardUid)}/${encodeURIComponent(env.dashboardSlug)}?${params.toString()}`;
}
