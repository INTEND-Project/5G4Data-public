import { withAppBasePath } from "@/lib/app-paths";

/** localStorage keys Grafana uses for docked navigation / sidebar (view + edit). */
export const GRAFANA_DOCKED_MENU_STORAGE_KEYS = [
  "grafana.navigation.docked",
  "grafana.ui.sidebar.dashboard-view.docked",
  "grafana.ui.sidebar.dashboard.docked",
] as const;

export function validateGrafanaOpenTarget(
  to: string,
  grafanaBaseUrl: string,
): string | null {
  if (!grafanaBaseUrl.trim() || !to.trim()) {
    return null;
  }

  try {
    const base = new URL(
      grafanaBaseUrl.endsWith("/") ? grafanaBaseUrl : `${grafanaBaseUrl}/`,
    );
    const target = new URL(to, base);

    if (target.origin !== base.origin) {
      return null;
    }

    const basePath = base.pathname.replace(/\/+$/, "") || "/grafana";
    if (!target.pathname.startsWith(basePath)) {
      return null;
    }

    return target.toString();
  } catch {
    return null;
  }
}

export function wrapGrafanaIntentOpenUrl(
  dashboardUrl: string,
  appBasePath: string,
  grafanaBaseUrl: string | undefined,
): string {
  if (!grafanaBaseUrl || !validateGrafanaOpenTarget(dashboardUrl, grafanaBaseUrl)) {
    return dashboardUrl;
  }

  const openPath = withAppBasePath("/api/grafana/open", appBasePath);
  const params = new URLSearchParams({ to: dashboardUrl });
  return `${openPath}?${params.toString()}`;
}

export function buildGrafanaDockedMenuBootstrapHtml(redirectUrl: string): string {
  const safeUrl = JSON.stringify(redirectUrl);
  const storageLines = GRAFANA_DOCKED_MENU_STORAGE_KEYS.map(
    (key) => `    localStorage.setItem(${JSON.stringify(key)}, "true");`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Opening Grafana…</title>
</head>
<body>
<script>
(function () {
  try {
${storageLines}
  } catch (e) {}
  location.replace(${safeUrl});
})();
</script>
</body>
</html>`;
}
