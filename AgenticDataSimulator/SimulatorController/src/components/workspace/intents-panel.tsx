"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  intentListPollIntervalMs,
  shouldPollIntentList,
} from "@/components/workspace/intent-list-polling";
import {
  deleteInStorageConfirmMessage,
  deleteInStorageLabel,
  DeleteStorageIcon,
  GrafanaIcon,
} from "@/components/workspace/workspace-storage-icons";
import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import { intentsEqual, type IntentListEntryLike } from "@/lib/intents/intent-list-equality";

type IntentListEntry = IntentListEntryLike & {
  dataStatus?: "pending" | "ready";
  metricsReady?: number;
  metricsTotal?: number;
};

type IntentsPanelProps = {
  selectedDomain: string;
  graphDbConnected: boolean;
  prometheusConnected: boolean;
  intentsApiUrl: string;
  intentsUrlBase: string;
  prometheusClearUrlBase: string;
};

const GRAFANA_CLICK_FEEDBACK_MS = 2000;

function resolveIntentCardStatus(
  intent: IntentListEntry,
  intentIdsAwaitingObservation: ReadonlySet<string>,
): "pending" | "ready" {
  if (intent.dataStatus === "ready") {
    return "ready";
  }
  if (intentIdsAwaitingObservation.has(intent.intentId)) {
    return "pending";
  }
  return intent.dataStatus ?? "pending";
}

function intentDataStatusHint(intent: IntentListEntry, cardStatus: "pending" | "ready"): string {
  if (cardStatus === "ready") {
    return `Observation data ready (${intent.metricsReady ?? 0}/${intent.metricsTotal ?? 0} metrics in ${intent.storage}).`;
  }
  const ready = intent.metricsReady ?? 0;
  const total = intent.metricsTotal ?? 0;
  if (total > 0) {
    return `Generating or storing observations (${ready}/${total} metrics in ${intent.storage})…`;
  }
  return `Waiting for observation data in ${intent.storage}…`;
}

export function IntentsPanel({
  selectedDomain,
  graphDbConnected,
  prometheusConnected,
  intentsApiUrl,
  intentsUrlBase,
  prometheusClearUrlBase,
}: IntentsPanelProps) {
  const {
    scriptRunLogs,
    storageRefreshNonce,
    beginStorageDeletion,
    endStorageDeletion,
    scriptRunInProgress,
    observationGenerationActive,
    intentIdsAwaitingObservation,
    prometheusBaseUrl,
  } = useWorkspaceScriptSession();
  const latestScriptRunId = scriptRunLogs[0]?.id ?? null;
  const initialScriptRunIdRef = useRef(latestScriptRunId);
  const [intents, setIntents] = useState<IntentListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingIntentId, setDeletingIntentId] = useState<string | null>(null);
  const [pendingGrafanaIntentIds, setPendingGrafanaIntentIds] = useState<Set<string>>(() => new Set());
  const pendingGrafanaIntentIdsRef = useRef<Set<string>>(new Set());
  const grafanaFeedbackTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [intentDescriptions, setIntentDescriptions] = useState<Record<string, string | null>>({});
  const [loadingDescriptions, setLoadingDescriptions] = useState<Record<string, boolean>>({});
  const intentDescriptionsRef = useRef(intentDescriptions);
  const loadingDescriptionsRef = useRef(loadingDescriptions);
  const intentsRef = useRef(intents);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    intentDescriptionsRef.current = intentDescriptions;
  }, [intentDescriptions]);

  useEffect(() => {
    loadingDescriptionsRef.current = loadingDescriptions;
  }, [loadingDescriptions]);

  useEffect(() => {
    intentsRef.current = intents;
  }, [intents]);

  useEffect(() => {
    const timeouts = grafanaFeedbackTimeoutsRef.current;

    return () => {
      for (const timeoutId of timeouts.values()) {
        clearTimeout(timeoutId);
      }
      timeouts.clear();
      pendingGrafanaIntentIdsRef.current.clear();
    };
  }, []);

  const loadIntents = useCallback(
    async (options?: { background?: boolean; lite?: boolean }) => {
      if (options?.background && loadInFlightRef.current) {
        return loadInFlightRef.current;
      }

      const run = async (): Promise<void> => {
        if (!options?.background) {
          setIsLoading(true);
          setActionError(null);
        }

        try {
          const params = new URLSearchParams({ domain: selectedDomain });
          if (options?.lite) {
            params.set("lite", "1");
          }
          const trimmedPrometheusBase = prometheusBaseUrl.trim();
          if (trimmedPrometheusBase) {
            params.set("prometheusBaseUrl", trimmedPrometheusBase);
          }

          const response = await fetch(`${intentsApiUrl}?${params.toString()}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            throw new Error(`Intent discovery failed with ${response.status}`);
          }

          const payload = (await response.json()) as { intents: IntentListEntry[] };
          const nextIntents = payload.intents ?? [];
          setIntents((currentIntents) =>
            intentsEqual(currentIntents, nextIntents) ? currentIntents : nextIntents,
          );
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
      };

      const promise = run();
      if (options?.background) {
        loadInFlightRef.current = promise;
      }

      try {
        await promise;
      } finally {
        if (loadInFlightRef.current === promise) {
          loadInFlightRef.current = null;
        }
      }
    },
    [intentsApiUrl, prometheusBaseUrl, selectedDomain],
  );

  useEffect(() => {
    if (!latestScriptRunId || latestScriptRunId === initialScriptRunIdRef.current) {
      return;
    }

    void loadIntents({ background: true, lite: true });
  }, [latestScriptRunId, loadIntents]);

  useEffect(() => {
    if (storageRefreshNonce === 0) {
      return;
    }

    setIntentDescriptions({});
    setLoadingDescriptions({});
    void loadIntents({ background: true, lite: true });
  }, [storageRefreshNonce, loadIntents]);

  const hasAnyBackend = graphDbConnected || prometheusConnected;
  const shouldPollIntents = shouldPollIntentList({
    intents,
    intentIdsAwaitingObservation,
    scriptRunInProgress,
    observationGenerationActive,
  });

  useEffect(() => {
    if (!hasAnyBackend || !shouldPollIntents) {
      return;
    }

    let intervalId: number | undefined;

    const tick = (): void => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      const pollState = {
        intents: intentsRef.current,
        intentIdsAwaitingObservation,
        scriptRunInProgress,
        observationGenerationActive,
      };

      if (!shouldPollIntentList(pollState)) {
        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
        return;
      }

      void loadIntents({ background: true, lite: true });
    };

    const intervalMs = intentListPollIntervalMs({
      scriptRunInProgress,
      observationGenerationActive,
      intentIdsAwaitingObservation,
    });

    tick();
    intervalId = window.setInterval(tick, intervalMs);

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    hasAnyBackend,
    intentIdsAwaitingObservation,
    loadIntents,
    observationGenerationActive,
    scriptRunInProgress,
    shouldPollIntents,
  ]);

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

  function handleGrafanaClick(
    event: React.MouseEvent<HTMLAnchorElement>,
    intent: IntentListEntry,
  ) {
    const intentId = intent.intentId;
    if (resolveIntentCardStatus(intent, intentIdsAwaitingObservation) !== "ready") {
      event.preventDefault();
      return;
    }

    if (pendingGrafanaIntentIdsRef.current.has(intentId)) {
      event.preventDefault();
      return;
    }

    pendingGrafanaIntentIdsRef.current.add(intentId);
    flushSync(() => {
      setPendingGrafanaIntentIds(new Set(pendingGrafanaIntentIdsRef.current));
    });

    const existingTimeout = grafanaFeedbackTimeoutsRef.current.get(intentId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeoutId = setTimeout(() => {
      grafanaFeedbackTimeoutsRef.current.delete(intentId);
      pendingGrafanaIntentIdsRef.current.delete(intentId);
      setPendingGrafanaIntentIds(new Set(pendingGrafanaIntentIdsRef.current));
    }, GRAFANA_CLICK_FEEDBACK_MS);

    grafanaFeedbackTimeoutsRef.current.set(intentId, timeoutId);
  }

  async function handleDelete(intent: IntentListEntry) {
    if (!window.confirm(deleteInStorageConfirmMessage(intent.intentId, intent.storage))) {
      return;
    }

    setDeletingIntentId(intent.intentId);
    setActionError(null);
    beginStorageDeletion();

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
      endStorageDeletion();
    }
  }

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Intents</h2>
        <button
          aria-label="Refresh intent list"
          className="workspace-button workspace-button-secondary workspace-panel-refresh-button"
          disabled={!hasAnyBackend || isLoading || deletingIntentId !== null}
          onClick={() => void loadIntents()}
          title={
            deletingIntentId
              ? "Wait until the current delete finishes before refreshing"
              : "Load intents from GraphDB and Prometheus"
          }
          type="button"
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {deletingIntentId ? (
        <p aria-live="polite" className="workspace-hint">
          Deleting {deletingIntentId}…
        </p>
      ) : null}
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
        ) : isLoading && deletingIntentId === null ? (
          <article className="workspace-card">
            <strong>Loading intents…</strong>
          </article>
        ) : intents.length === 0 && deletingIntentId === null ? (
          <article className="workspace-card">
            <strong>No intents loaded yet</strong>
            <p>Click Refresh to load intents from GraphDB and Prometheus, or run a script.</p>
          </article>
        ) : null}
        {intents.map((intent) => {
          const cardStatus = resolveIntentCardStatus(intent, intentIdsAwaitingObservation);
          const grafanaReady = cardStatus === "ready" && Boolean(intent.grafanaUrl);

          return (
          <article
            className={`workspace-card workspace-card-intent workspace-card-intent--${cardStatus}`}
            key={intent.intentId}
          >
            <div className="workspace-heading-row workspace-intent-card-heading">
              <strong
                className="workspace-intent-id-label"
                onMouseEnter={() => void loadIntentDescription(intent.intentId)}
                title={intentHoverTitle(intent.intentId)}
              >
                {intent.intentId}
              </strong>
              <div className="workspace-kg-target-actions">
                {grafanaReady ? (
                  <a
                    aria-busy={pendingGrafanaIntentIds.has(intent.intentId)}
                    aria-label={`Open Grafana dashboard for ${intent.intentId}`}
                    className={`workspace-button workspace-button-secondary workspace-kg-target-action${
                      pendingGrafanaIntentIds.has(intent.intentId)
                        ? " workspace-kg-target-action-grafana-pending"
                        : ""
                    }`}
                    href={intent.grafanaUrl!}
                    onClick={(event) => handleGrafanaClick(event, intent)}
                    rel="noopener noreferrer"
                    target="_blank"
                    title={
                      pendingGrafanaIntentIds.has(intent.intentId)
                        ? "Opening Grafana dashboard…"
                        : "Open Grafana timeseries dashboard (historic time range aligned to stored observations)"
                    }
                  >
                    <GrafanaIcon />
                  </a>
                ) : (
                  <button
                    aria-label={`Grafana dashboard unavailable for ${intent.intentId}`}
                    className="workspace-button workspace-button-secondary workspace-kg-target-action"
                    disabled
                    title={
                      intent.grafanaUrl
                        ? intentDataStatusHint(intent, cardStatus)
                        : cardStatus === "pending"
                          ? intentDataStatusHint(intent, cardStatus)
                          : "Configure GRAFANA_BASE_URL to open Grafana dashboards"
                    }
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
            <p className="workspace-intent-data-status" title={intentDataStatusHint(intent, cardStatus)}>
              {intentDataStatusHint(intent, cardStatus)}
            </p>
          </article>
          );
        })}
      </div>
    </section>
  );
}
