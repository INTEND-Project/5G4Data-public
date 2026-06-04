import { loadAppEnv } from "@/lib/env";
import { normalizePrometheusBaseUrl, normalizePushgatewayBaseUrl } from "@/lib/prometheus/urls";

import { resolvePrometheusBaseUrl } from "./resolve-base-url";

const LOCAL_PROMETHEUS_HOSTS = new Set(["127.0.0.1", "localhost", "host.docker.internal"]);

function normalizedHost(baseUrl: string): string {
  try {
    return new URL(baseUrl.replace(/\/$/, "") || baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True when Prometheus API base is the lab stack on this host (not a partner/external URL). */
export function isLocalPrometheusStack(prometheusBaseUrl: string): boolean {
  const host = normalizedHost(prometheusBaseUrl);
  if (!LOCAL_PROMETHEUS_HOSTS.has(host)) {
    return false;
  }

  const env = loadAppEnv(process.env);
  const defaultHost = normalizedHost(env.prometheusUrl);
  if (LOCAL_PROMETHEUS_HOSTS.has(defaultHost) && host === defaultHost) {
    return true;
  }

  return LOCAL_PROMETHEUS_HOSTS.has(host);
}

export function usesPushgatewayForStreaming(prometheusBaseUrl: string): boolean {
  return isLocalPrometheusStack(prometheusBaseUrl);
}

export function prometheusRemoteWriteUrl(prometheusBaseUrl: string): string {
  const base = prometheusBaseUrl.replace(/\/$/, "");
  return `${base}/api/v1/write`;
}

export function resolvePushgatewayBaseUrl(): string {
  const env = loadAppEnv(process.env);
  return normalizePushgatewayBaseUrl(env.pushgatewayUrl);
}

export type PrometheusStackMode = "local" | "external";

export function prometheusStackMode(prometheusBaseUrl?: string | null): PrometheusStackMode {
  const base = resolvePrometheusBaseUrl(prometheusBaseUrl);
  return isLocalPrometheusStack(base) ? "local" : "external";
}
