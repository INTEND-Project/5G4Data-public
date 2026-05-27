"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CONNECTED_POLL_MS } from "@/components/workspace/infra-connection-status";
import {
  deleteInStorageConfirmMessage,
  deleteInStorageLabel,
  DeleteStorageIcon,
  GrafanaIcon,
} from "@/components/workspace/workspace-storage-icons";
import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import type { ObservationStorageType } from "@/lib/observation-storage";

type IntentListEntry = {
  intentId: string;
  storage: ObservationStorageType;
  grafanaUrl: string | null;
};

type IntentsPanelProps = {
  selectedDomain: string;
  graphDbConnected: boolean;
  prometheusConnected: boolean;
  intentsApiUrl: string;
  intentsApiUrl: string;
  intentsUrlBase: string;
  prometheusClearUrlBase: string;
};

export function IntentsPanel({
  selectedDomain,
  graphDbConnected,
  prometheusConnected,
  intentsApiUrl,
  intentsUrlBase,
  prometheusClearUrlBase,
}: IntentsPanelProps) {
  const { scriptRunLogs } = useWorkspaceScriptSession();
  const latestScriptRunId = scriptRunLogs[0]?.id ?? null;
  const [intents, setIntents] = useState<IntentListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingIntentId, setDeletingIntentId] = useState<string | null>(null);
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

  const loadIntents = useCallback(
    async (options?: { background?: boolean }) => {
      if (!options?.background) {
        setIsLoading(true);
        setActionError(null);
      }

      try {
        const params = new URLSearchParams({ domain: selectedDomain });
        const response = await fetch(`${intentsApiUrl}?${params.toString()}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Intent discovery failed with ${response.status}`);
        }

        const payload = (await response.json()) as { intents: IntentListEntry[] };
        setIntents(payload.intents ?? []);
        if (!options?.background) {
          setActionError(null);
        }
      } catch (error) {
        console.error(error);
        if (!options?.background) {
          setActionError("Unable to load intents right now.");
          setIntents([]);
        }
      } finally {
        if (!options?.background) {
          setIsLoading(false);
        }
      }
    },
    [intentsApiUrl, selectedDomain],
  );

  useEffect(() => {
    void loadIntents();
  }, [loadIntents]);

  useEffect(() => {
    if (!latestScriptRunId) {
      return;
    }

    void loadIntents({ background: true });
  }, [latestScriptRunId, loadIntents]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      void loadIntents({ background: true });
    }, CONNECTED_POLL_MS);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void loadIntents({ background: true });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadIntents]);

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
          `${intentsUrlBase}/${encodeURIComponent(intentId)}/description?${params.toString()}`,
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
    [graphDbConnected, intentsUrlBase, selectedDomain],
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

  async function handleDelete(intent: IntentListEntry) {
    if (!window.confirm(deleteInStorageConfirmMessage(intent.intentId, intent.storage))) {
      return;
    }

    setDeletingIntentId(intent.intentId);
    setActionError(null);

    try {
      const params = new URLSearchParams({ domain: selectedDomain });
      const endpoint =
        intent.storage === "prometheus"
          ? `${prometheusClearUrlBase}/${encodeURIComponent(intent.intentId)}/empty`
          : `${intentsUrlBase}/${encodeURIComponent(intent.intentId)}/empty-graphdb?${params.toString()}`;

      const response = await fetch(endpoint, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Delete in ${intent.storage} failed with ${response.status}`);
      }

      setIntents((currentIntents) =>
        currentIntents.filter((currentIntent) => currentIntent.intentId !== intent.intentId),
      );
    } catch (error) {
      console.error(error);
      setActionError(`Unable to ${deleteInStorageLabel(intent.storage).toLowerCase()} right now.`);
    } finally {
      setDeletingIntentId(null);
    }
  }

  const hasAnyBackend = graphDbConnected || prometheusConnected;

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Intents</h2>
      </div>
      {actionError ? (
        <p aria-live="polite" className="workspace-hint">
          {actionError}
        </p>
      ) : null}
      <div className="workspace-stack">
        {!hasAnyBackend ? (
          <article className="workspace-card">
            <strong>No storage backends reachable</strong>
            <p>Connect GraphDB or Prometheus to discover intents for this domain.</p>
          </article>
        ) : isLoading ? (
          <article className="workspace-card">
            <strong>Loading intents…</strong>
          </article>
        ) : intents.length === 0 ? (
          <article className="workspace-card">
            <strong>No intents found yet</strong>
            <p>Create intents in a knowledge graph target or run observation reports.</p>
          </article>
        ) : null}
        {intents.map((intent) => (
          <article className="workspace-card" key={intent.intentId}>
            <div className="workspace-heading-row">
              <strong
                className="workspace-intent-id-label"
                onMouseEnter={() => void loadIntentDescription(intent.intentId)}
                title={intentHoverTitle(intent.intentId)}
              >
                {intent.intentId}
              </strong>
              <div className="workspace-kg-target-actions">
                {intent.grafanaUrl ? (
                  <a
                    aria-label={`Open Grafana dashboard for ${intent.intentId}`}
                    className="workspace-button workspace-button-secondary workspace-kg-target-action"
                    href={intent.grafanaUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    title="Open Grafana timeseries dashboard for this intent"
                  >
                    <GrafanaIcon />
                  </a>
                ) : (
                  <button
                    aria-label={`Grafana dashboard unavailable for ${intent.intentId}`}
                    className="workspace-button workspace-button-secondary workspace-kg-target-action"
                    disabled
                    title="Configure GRAFANA_BASE_URL to open Grafana dashboards"
                    type="button"
                  >
                    <GrafanaIcon />
                  </button>
                )}
                <button
                  aria-label={`${deleteInStorageLabel(intent.storage)} for ${intent.intentId}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action"
                  disabled={deletingIntentId === intent.intentId}
                  onClick={() => void handleDelete(intent)}
                  title={deleteInStorageLabel(intent.storage)}
                  type="button"
                >
                  {deletingIntentId === intent.intentId ? (
                    "Deleting..."
                  ) : (
                    <DeleteStorageIcon storage={intent.storage} />
                  )}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
