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

/** True when Prometheus API base is the managed lab stack (server default or loopback), not a partner URL. */
export function isLocalPrometheusStack(prometheusBaseUrl: string): boolean {
  const candidate = normalizePrometheusBaseUrl(prometheusBaseUrl.trim());

  const env = loadAppEnv(process.env);
  const serverDefault = normalizePrometheusBaseUrl(env.prometheusUrl);
  if (candidate === serverDefault) {
    return true;
  }

  const host = normalizedHost(candidate);
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
