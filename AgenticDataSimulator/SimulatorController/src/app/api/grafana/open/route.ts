import { loadAppEnv } from "@/lib/env";
import {
  buildGrafanaDockedMenuBootstrapHtml,
  validateGrafanaOpenTarget,
} from "@/lib/grafana/open-url";

export async function GET(request: Request) {
  const to = new URL(request.url).searchParams.get("to");
  if (!to) {
    return new Response("Missing to parameter", { status: 400 });
  }

  const env = loadAppEnv(process.env);
  const grafanaBaseUrl = env.grafanaBaseUrl;
  if (!grafanaBaseUrl) {
    return new Response("Grafana is not configured", { status: 503 });
  }

  const target = validateGrafanaOpenTarget(to, grafanaBaseUrl);
  if (!target) {
    return new Response("Invalid Grafana URL", { status: 400 });
  }

  return new Response(buildGrafanaDockedMenuBootstrapHtml(target), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
