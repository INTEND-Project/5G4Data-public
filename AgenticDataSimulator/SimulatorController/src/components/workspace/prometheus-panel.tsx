"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PrometheusPanelProps = {
  prometheusConnected: boolean;
  graphDbConnected: boolean;
  selectedDomain: string;
  intentsApiUrl: string;
  clearUrlBase: string;
};

function EmptyPrometheusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="18"
    >
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      <path d="M20 7 4 17" />
    </svg>
  );
}

export function PrometheusPanel({
  prometheusConnected,
  graphDbConnected,
  selectedDomain,
  intentsApiUrl,
  clearUrlBase,
}: PrometheusPanelProps) {
  const [intentIds, setIntentIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [emptyingIntentId, setEmptyingIntentId] = useState<string | null>(null);
  const [intentDescriptions, setIntentDescriptions] = useState<Record<string, string | null>>({});
  const [loadingDescriptions, setLoadingDescriptions] = useState<Record<string, boolean>>({});
  const intentDescriptionsRef = useRef(intentDescriptions);
  const loadingDescriptionsRef = useRef(loadingDescriptions);

  useEffect(() => {
    intentDescriptionsRef.current = intentDescriptions;
  }, [intentDescriptions]);

  useEffect(() => {
    loadingDescriptionsRef.current = loadingDescriptions;
  }, [loadingDescriptions]);

  const loadIntentIds = useCallback(async () => {
    if (!prometheusConnected) {
      setIntentIds([]);
      return;
    }

    setIsLoading(true);
    setActionError(null);

    try {
      const response = await fetch(intentsApiUrl);

      if (!response.ok) {
        throw new Error(`Prometheus intent discovery failed with ${response.status}`);
      }

      const payload = (await response.json()) as { intentIds: string[] };
      setIntentIds(payload.intentIds ?? []);
    } catch (error) {
      console.error(error);
      setActionError("Unable to load intent metrics from Prometheus right now.");
      setIntentIds([]);
    } finally {
      setIsLoading(false);
    }
  }, [intentsApiUrl, prometheusConnected]);

  useEffect(() => {
    void loadIntentIds();
  }, [loadIntentIds]);

  const loadIntentDescription = useCallback(
    async (intentId: string) => {
      if (!graphDbConnected) {
        return;
      }

      if (
        intentId in intentDescriptionsRef.current ||
        loadingDescriptionsRef.current[intentId]
      ) {
        return;
      }

      setLoadingDescriptions((current) => ({ ...current, [intentId]: true }));

      try {
        const params = new URLSearchParams({ domain: selectedDomain });
        const response = await fetch(
          `${clearUrlBase}/${encodeURIComponent(intentId)}/description?${params.toString()}`,
        );

        if (!response.ok) {
          throw new Error(`Intent description lookup failed with ${response.status}`);
        }

        const payload = (await response.json()) as { description: string | null };
        setIntentDescriptions((current) => ({
          ...current,
          [intentId]: payload.description ?? null,
        }));
      } catch (error) {
        console.error(error);
        setIntentDescriptions((current) => ({
          ...current,
          [intentId]: null,
        }));
      } finally {
        setLoadingDescriptions((current) => {
          const next = { ...current };
          delete next[intentId];
          return next;
        });
      }
    },
    [clearUrlBase, graphDbConnected, selectedDomain],
  );

  function intentHoverTitle(intentId: string): string | undefined {
    if (!graphDbConnected) {
      return "GraphDB is not reachable";
    }

    if (loadingDescriptions[intentId]) {
      return "Loading intent description…";
    }

    const description = intentDescriptions[intentId];
    if (description === undefined) {
      return undefined;
    }

    return description ?? "No intent description found in GraphDB";
  }

  async function handleEmpty(intentId: string) {
    if (
      !window.confirm(
        `Empty all Prometheus metrics for intent ${intentId}? Pushgateway samples and TSDB series for this intent will be removed.`,
      )
    ) {
      return;
    }

    setEmptyingIntentId(intentId);
    setActionError(null);

    try {
      const response = await fetch(`${clearUrlBase}/${encodeURIComponent(intentId)}/empty`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Prometheus empty failed with ${response.status}`);
      }

      setIntentIds((currentIntentIds) =>
        currentIntentIds.filter((currentIntentId) => currentIntentId !== intentId),
      );
    } catch (error) {
      console.error(error);
      setActionError("Unable to empty Prometheus metrics for that intent right now.");
    } finally {
      setEmptyingIntentId(null);
    }
  }

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Prometheus</h2>
        <span
          className={`workspace-chip ${
            prometheusConnected ? "workspace-chip-live" : "workspace-chip-down"
          }`}
        >
          Prometheus
        </span>
      </div>
      {actionError ? (
        <p aria-live="polite" className="workspace-hint">
          {actionError}
        </p>
      ) : null}
      <div className="workspace-stack">
        {!prometheusConnected ? (
          <article className="workspace-card">
            <strong>Prometheus is not reachable</strong>
            <p>Configure PROMETHEUS_URL and confirm the service is running.</p>
          </article>
        ) : isLoading ? (
          <article className="workspace-card">
            <strong>Loading intent metrics…</strong>
          </article>
        ) : intentIds.length === 0 ? (
          <article className="workspace-card">
            <strong>No intent observation metrics found in Prometheus.</strong>
          </article>
        ) : null}
        {intentIds.map((intentId) => (
          <article className="workspace-card" key={intentId}>
            <div className="workspace-heading-row">
              <strong
                className="workspace-intent-id-label"
                onMouseEnter={() => void loadIntentDescription(intentId)}
                title={intentHoverTitle(intentId)}
              >
                {intentId}
              </strong>
              <div className="workspace-kg-target-actions">
                <button
                  aria-label={`Empty Prometheus metrics for ${intentId}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action"
                  disabled={emptyingIntentId === intentId}
                  onClick={() => void handleEmpty(intentId)}
                  title="Empty Prometheus: remove TSDB series and Pushgateway samples for this intent"
                  type="button"
                >
                  {emptyingIntentId === intentId ? "Emptying..." : <EmptyPrometheusIcon />}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
