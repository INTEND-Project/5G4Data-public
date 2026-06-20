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
  process.env.PROMETHEUS_URL = normalizedBase;
  process.env.PROMETHEUS_REMOTE_WRITE_URL = prometheusRemoteWriteUrlFromBase(normalizedBase);

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
