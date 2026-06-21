import { resetPrometheusBufferForTests } from "./observationStorage/prometheusBackend.js";

export type SessionPrometheusBinding = {
  prometheusBaseUrl?: string | null;
  prometheusStorageMode?: PrometheusStackMode | null;
};

const LOCAL_PROMETHEUS_HOSTS = new Set(["127.0.0.1", "localhost", "host.docker.internal"]);

export function isLocalPrometheusStack(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.replace(/\/$/, "") || baseUrl).hostname.toLowerCase();
    return LOCAL_PROMETHEUS_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function prometheusRemoteWriteUrlFromBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/write`;
}

function isLoopbackPrometheusHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Remote-write URL for the current runtime (container agents reach host via host.docker.internal). */
export function prometheusRemoteWriteUrlForRuntime(baseUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const inContainer = process.env.SIMULATOR_AGENT_CONTAINER?.trim().toLowerCase() === "true";
  if (!inContainer) {
    return prometheusRemoteWriteUrlFromBase(normalizedBase);
  }

  try {
    const parsed = new URL(normalizedBase);
    if (isLoopbackPrometheusHost(parsed.hostname)) {
      parsed.hostname = "host.docker.internal";
    }
    return prometheusRemoteWriteUrlFromBase(parsed.toString().replace(/\/$/, ""));
  } catch {
    return prometheusRemoteWriteUrlFromBase(normalizedBase);
  }
}

export type PrometheusStackMode = "local" | "external";

export function resolvePrometheusStorageMode(
  baseUrl: string,
  explicit?: PrometheusStackMode | null,
): PrometheusStackMode {
  if (explicit === "local" || explicit === "external") {
    return explicit;
  }
  return isLocalPrometheusStack(baseUrl) ? "local" : "external";
}

/** Apply workspace Prometheus binding from the kernel chat session to process.env. */
export function applySessionPrometheusBinding(session: SessionPrometheusBinding): void {
  const base = session.prometheusBaseUrl?.trim();
  if (!base) {
    return;
  }

  const normalizedBase = base.replace(/\/$/, "");
  // GraphDB hasQuery metadata: keep Controller/host URL (127.0.0.1) for IntentReportQueryProxy.
  process.env.PROMETHEUS_URL = normalizedBase;
  process.env.PROMETHEUS_REMOTE_WRITE_URL = prometheusRemoteWriteUrlForRuntime(normalizedBase);

  const mode = resolvePrometheusStorageMode(
    normalizedBase,
    session.prometheusStorageMode ?? null,
  );
  process.env.PROMETHEUS_STORAGE_MODE = mode;

  if (mode === "external") {
    delete process.env.PUSHGATEWAY_URL;
  }
}

export function usesRemoteWriteForStreaming(): boolean {
  return process.env.PROMETHEUS_STORAGE_MODE?.trim() === "external";
}

export function resolvePrometheusWriteMode(
  observationMode: "streaming" | "historic",
  usesPrometheus: boolean,
): "push" | "buffer" | undefined {
  if (!usesPrometheus) {
    return undefined;
  }
  if (usesRemoteWriteForStreaming()) {
    return "buffer";
  }
  if (observationMode === "historic") {
    return "buffer";
  }
  return "push";
}

export function resetPrometheusBackendForSession(): void {
  resetPrometheusBufferForTests();
}
