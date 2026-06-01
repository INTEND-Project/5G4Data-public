import { loadAppEnv } from "@/lib/env";
import {
  createGrafanaLoginToken,
  parseGrafanaJwtEditorUsers,
  resolveGrafanaJwtOrgRole,
} from "@/lib/grafana/jwt-login-token";
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

  const window = historicGrafanaWindow(bounds, Date.now());
  return {
    from: String(window.fromMs),
    to: String(window.toMs),
  };
}

export function buildIntentGrafanaUrl(input: {
  intentId: string;
  conditionMetrics: string[];
  bounds: ObservationTimeBounds | null;
  repositoryId?: string | null;
  graphIri?: string | null;
  env?: GrafanaDashboardEnv;
  /** When set with GRAFANA_JWT_SECRET, appends auth_token for automatic Grafana login. */
  loginUsername?: string | null;
  envSource?: Partial<Record<string, string | undefined>>;
}): string | null {
  const env = input.env ?? grafanaDashboardEnvFromProcess(input.envSource);
  if (!env.baseUrl) {
    return null;
  }

  const appEnv = loadAppEnv(input.envSource ?? process.env);
  const base = env.baseUrl.replace(/\/$/, "");
  const time = buildGrafanaTimeParams(input.bounds);
  const params = new URLSearchParams({
    "var-intent_id": input.intentId,
    from: time.from,
    to: time.to,
  });

  if (input.conditionMetrics.length > 0) {
    for (const metric of input.conditionMetrics) {
      params.append("var-condition_metrics", metric);
    }
  }

  if (input.repositoryId) {
    params.set("var-repository_id", input.repositoryId);
  }
  if (input.graphIri) {
    params.set("var-graph_iri", input.graphIri);
  }

  const loginUsername = input.loginUsername?.trim();
  if (loginUsername && appEnv.grafanaJwtSecret) {
    params.set(
      "auth_token",
      createGrafanaLoginToken({
        username: loginUsername,
        emailDomain: appEnv.grafanaUserEmailDomain,
        secret: appEnv.grafanaJwtSecret,
        ttlSeconds: appEnv.grafanaJwtTtlSeconds,
        orgRole: resolveGrafanaJwtOrgRole(
          loginUsername,
          parseGrafanaJwtEditorUsers(appEnv.grafanaJwtEditorUsers),
        ),
      }),
    );
  }

  return `${base}/d/${encodeURIComponent(env.dashboardUid)}/${encodeURIComponent(env.dashboardSlug)}?${params.toString()}`;
}
