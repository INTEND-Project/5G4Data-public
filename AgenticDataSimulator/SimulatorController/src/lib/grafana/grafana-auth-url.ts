import { loadAppEnv } from "@/lib/env";
import {
  createGrafanaLoginToken,
  parseGrafanaJwtEditorUsers,
  resolveGrafanaJwtOrgRole,
} from "@/lib/grafana/jwt-login-token";

export function stripGrafanaAuthToken(dashboardUrl: string): string {
  const url = new URL(dashboardUrl);
  url.searchParams.delete("auth_token");
  return url.toString();
}

/** Mint a fresh JWT and attach it to a validated Grafana dashboard URL (click-time login). */
export function withFreshGrafanaAuthToken(
  dashboardUrl: string,
  loginUsername: string | null | undefined,
  envSource: Partial<Record<string, string | undefined>> = process.env,
): string {
  const withoutToken = stripGrafanaAuthToken(dashboardUrl);
  const username = loginUsername?.trim();
  const appEnv = loadAppEnv(envSource);

  if (!username || !appEnv.grafanaJwtSecret) {
    return withoutToken;
  }

  const url = new URL(withoutToken);
  url.searchParams.set(
    "auth_token",
    createGrafanaLoginToken({
      username,
      emailDomain: appEnv.grafanaUserEmailDomain,
      secret: appEnv.grafanaJwtSecret,
      ttlSeconds: appEnv.grafanaJwtTtlSeconds,
      orgRole: resolveGrafanaJwtOrgRole(
        username,
        parseGrafanaJwtEditorUsers(appEnv.grafanaJwtEditorUsers),
      ),
    }),
  );

  return url.toString();
}
