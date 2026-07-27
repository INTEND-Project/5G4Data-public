"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import { withAppBasePath } from "@/lib/app-paths";
import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";

type PrometheusPanelProps = {
  prometheusConnected: boolean;
};

export function PrometheusPanel({ prometheusConnected }: PrometheusPanelProps) {
  const {
    defaultPrometheusBaseUrl,
    prometheusBaseUrl,
    setPrometheusBaseUrl,
  } = useWorkspaceScriptSession();
  const [draftUrl, setDraftUrl] = useState(prometheusBaseUrl);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [customReachable, setCustomReachable] = useState<boolean | null>(null);

  useEffect(() => {
    setDraftUrl(prometheusBaseUrl);
  }, [prometheusBaseUrl]);

  const applyUrl = useCallback(() => {
    const parsed = parsePrometheusBaseUrlInput(draftUrl);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }
    setValidationError(null);
    setPrometheusBaseUrl(parsed.url.replace(/\/$/, "") || parsed.url);
  }, [draftUrl, setPrometheusBaseUrl]);

  const resetToDefault = useCallback(() => {
    setDraftUrl(defaultPrometheusBaseUrl.replace(/\/$/, ""));
    setValidationError(null);
    setPrometheusBaseUrl(defaultPrometheusBaseUrl);
    setCustomReachable(null);
  }, [defaultPrometheusBaseUrl, setPrometheusBaseUrl]);

  useEffect(() => {
    const trimmed = prometheusBaseUrl.trim();
    const isCustomUrl =
      trimmed.length > 0 &&
      trimmed.replace(/\/$/, "") !== defaultPrometheusBaseUrl.replace(/\/$/, "");

    if (!isCustomUrl) {
      setCustomReachable(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const base = parsePrometheusBaseUrlInput(trimmed);
          if (!base.ok || cancelled) {
            if (!cancelled) {
              setCustomReachable(false);
            }
            return;
          }
          const params = new URLSearchParams({ prometheusBaseUrl: base.url });
          const response = await fetch(
            `${withAppBasePath("/api/prometheus/status")}?${params.toString()}`,
            {
              cache: "no-store",
              credentials: "same-origin",
            },
          );
          if (!cancelled) {
            if (!response.ok) {
              setCustomReachable(false);
              return;
            }
            const payload = (await response.json()) as { connected?: boolean };
            setCustomReachable(payload.connected === true);
          }
        } catch {
          if (!cancelled) {
            setCustomReachable(false);
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [defaultPrometheusBaseUrl, prometheusBaseUrl]);

  const showCustomChip =
    prometheusBaseUrl.trim().length > 0 &&
    prometheusBaseUrl.replace(/\/$/, "") !== defaultPrometheusBaseUrl.replace(/\/$/, "");

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Prometheus base URL:</h2>
        <span
          className={`workspace-chip ${
            (showCustomChip ? customReachable : prometheusConnected)
              ? "workspace-chip-live"
              : "workspace-chip-down"
          }`}
        >
          {showCustomChip && customReachable === null
            ? "Checking…"
            : (showCustomChip ? customReachable : prometheusConnected)
              ? "Reachable"
              : "Unreachable"}
        </span>
      </div>
      <div className="workspace-stack">
        <article className="workspace-card">
          <div className="workspace-runner-field workspace-prometheus-url-field">
            <input
              aria-label="Prometheus base URL"
              className="workspace-input workspace-prometheus-url-input"
              id="prometheus-base-url"
              onChange={(event) => {
                setDraftUrl(event.target.value);
                setValidationError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyUrl();
                }
              }}
              placeholder={defaultPrometheusBaseUrl}
              spellCheck={false}
              type="url"
              value={draftUrl}
            />
          </div>
          {validationError ? (
            <p className="workspace-form-error" role="alert">
              {validationError}
            </p>
          ) : null}
          <div className="workspace-prometheus-url-actions">
            <button
              className="workspace-button workspace-button-secondary workspace-prometheus-url-action-button"
              onClick={applyUrl}
              type="button"
            >
              Apply
            </button>
            <button
              className="workspace-button workspace-button-secondary workspace-prometheus-url-action-button"
              onClick={resetToDefault}
              type="button"
            >
              Use server default
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
