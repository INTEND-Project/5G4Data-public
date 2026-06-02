"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import { parsePrometheusBaseUrlInput } from "@/lib/prometheus/resolve-base-url";
import { prometheusHealthCheckUrl } from "@/lib/prometheus/urls";

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
    if (!trimmed) {
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
          const response = await fetch(prometheusHealthCheckUrl(base.url), {
            cache: "no-store",
          });
          if (!cancelled) {
            setCustomReachable(response.ok);
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
  }, [prometheusBaseUrl]);

  const showCustomChip =
    prometheusBaseUrl.trim().length > 0 &&
    prometheusBaseUrl.replace(/\/$/, "") !== defaultPrometheusBaseUrl.replace(/\/$/, "");

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Prometheus</h2>
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
          <strong>Prometheus base URL</strong>
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
              className="workspace-button workspace-button-secondary"
              onClick={applyUrl}
              type="button"
            >
              Apply
            </button>
            <button
              className="workspace-button workspace-button-secondary"
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
