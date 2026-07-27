"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import { buildKgNamePrefix } from "@/lib/graphdb/naming";
import { parseGraphDbBaseUrlInput } from "@/lib/graphdb/resolve-base-url";
import { withAppBasePath } from "@/lib/app-paths";

type KgTargetRecord = {
  id: string;
  displayName: string;
  repositoryId: string;
  graphIri: string;
};

type KgTargetPanelProps = {
  selectedDomain: string;
  username: string;
  createUrl: string;
  deleteUrlBase: string;
  graphDbConnected: boolean;
  onTargetCreated: (target: KgTargetRecord) => void;
  onTargetDeleted: (targetId: string) => void;
  targets: KgTargetRecord[];
};

function workspaceInfraUrlParams(graphDbBaseUrl: string, prometheusBaseUrl: string): URLSearchParams {
  const params = new URLSearchParams();
  const trimmedGraph = graphDbBaseUrl.trim();
  if (trimmedGraph) {
    params.set("graphDbBaseUrl", trimmedGraph);
  }
  const trimmedPrometheus = prometheusBaseUrl.trim();
  if (trimmedPrometheus) {
    params.set("prometheusBaseUrl", trimmedPrometheus);
  }
  return params;
}

function defaultKgNameSuffix(): string {
  return "test";
}

function EmptyKgIcon() {
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

function DeleteRepoIcon() {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9z"
        fill="currentColor"
      />
    </svg>
  );
}

export function KgTargetPanel({
  selectedDomain,
  username,
  createUrl,
  deleteUrlBase,
  graphDbConnected,
  onTargetCreated,
  onTargetDeleted,
  targets,
}: KgTargetPanelProps) {
  const {
    notifyStorageChanged,
    beginStorageDeletion,
    endStorageDeletion,
    defaultGraphDbBaseUrl,
    graphDbBaseUrl,
    prometheusBaseUrl,
    setGraphDbBaseUrl,
  } = useWorkspaceScriptSession();
  const [draftUrl, setDraftUrl] = useState(graphDbBaseUrl);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [customReachable, setCustomReachable] = useState<boolean | null>(null);
  const kgNamePrefix = useMemo(
    () => buildKgNamePrefix(selectedDomain, username),
    [selectedDomain, username],
  );
  const [nameSuffix, setNameSuffix] = useState(defaultKgNameSuffix);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null);
  const [emptyingTargetId, setEmptyingTargetId] = useState<string | null>(null);

  useEffect(() => {
    setDraftUrl(graphDbBaseUrl);
  }, [graphDbBaseUrl]);

  const applyUrl = useCallback(() => {
    const parsed = parseGraphDbBaseUrlInput(draftUrl);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }
    setValidationError(null);
    setGraphDbBaseUrl(parsed.url.replace(/\/$/, "") || parsed.url);
  }, [draftUrl, setGraphDbBaseUrl]);

  const resetToDefault = useCallback(() => {
    setDraftUrl(defaultGraphDbBaseUrl.replace(/\/$/, ""));
    setValidationError(null);
    setGraphDbBaseUrl(defaultGraphDbBaseUrl);
    setCustomReachable(null);
  }, [defaultGraphDbBaseUrl, setGraphDbBaseUrl]);

  useEffect(() => {
    const trimmed = graphDbBaseUrl.trim();
    const isCustomUrl =
      trimmed.length > 0 &&
      trimmed.replace(/\/$/, "") !== defaultGraphDbBaseUrl.replace(/\/$/, "");

    if (!isCustomUrl) {
      setCustomReachable(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const base = parseGraphDbBaseUrlInput(trimmed);
          if (!base.ok || cancelled) {
            if (!cancelled) {
              setCustomReachable(false);
            }
            return;
          }
          const params = new URLSearchParams({ graphDbBaseUrl: base.url });
          const response = await fetch(
            `${withAppBasePath("/api/graphdb/status")}?${params.toString()}`,
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
  }, [defaultGraphDbBaseUrl, graphDbBaseUrl]);

  const showCustomChip =
    graphDbBaseUrl.trim().length > 0 &&
    graphDbBaseUrl.replace(/\/$/, "") !== defaultGraphDbBaseUrl.replace(/\/$/, "");

  async function handleCreate() {
    const trimmedName = nameSuffix.trim();

    if (!trimmedName) {
      setCreateError("Enter a knowledge graph name suffix first.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch(createUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain: selectedDomain,
          displayName: trimmedName,
          graphDbBaseUrl: graphDbBaseUrl.trim() || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`KG creation failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        target: {
          id: string;
          displayName: string;
          repositoryId: string;
          graphIri: string;
        };
      };

      onTargetCreated(payload.target);
      setNameSuffix(defaultKgNameSuffix());
    } catch (error) {
      console.error(error);
      setCreateError("Unable to create the knowledge graph target right now.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleEmpty(target: { id: string; repositoryId: string }) {
    if (
      !window.confirm(
        `Empty all triples in ${target.repositoryId}? The GraphDB repository and named graph will remain.`,
      )
    ) {
      return;
    }

    setEmptyingTargetId(target.id);
    setCreateError(null);
    beginStorageDeletion();

    try {
      const params = workspaceInfraUrlParams(graphDbBaseUrl, prometheusBaseUrl);
      const query = params.toString();
      const response = await fetch(
        `${deleteUrlBase}/${target.id}/empty${query ? `?${query}` : ""}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error(`KG empty failed with ${response.status}`);
      }

      notifyStorageChanged();
    } catch (error) {
      console.error(error);
      setCreateError("Unable to empty the knowledge graph right now.");
    } finally {
      setEmptyingTargetId(null);
      endStorageDeletion();
    }
  }

  async function handleDelete(target: { id: string; repositoryId: string }) {
    if (
      !window.confirm(
        `Delete ${target.repositoryId} and remove its GraphDB repository? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingTargetId(target.id);
    setCreateError(null);
    beginStorageDeletion();

    try {
      const params = workspaceInfraUrlParams(graphDbBaseUrl, prometheusBaseUrl);
      const query = params.toString();
      const response = await fetch(
        `${deleteUrlBase}/${target.id}${query ? `?${query}` : ""}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(`KG deletion failed with ${response.status}`);
      }

      onTargetDeleted(target.id);
    } catch (error) {
      console.error(error);
      setCreateError("Unable to delete the knowledge graph target right now.");
    } finally {
      setDeletingTargetId(null);
      endStorageDeletion();
    }
  }

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>GraphDB base URL:</h2>
        <span
          className={`workspace-chip ${
            (showCustomChip ? customReachable : graphDbConnected)
              ? "workspace-chip-live"
              : "workspace-chip-down"
          }`}
        >
          {showCustomChip && customReachable === null
            ? "Checking…"
            : (showCustomChip ? customReachable : graphDbConnected)
              ? "Reachable"
              : "Unreachable"}
        </span>
      </div>
      <div className="workspace-stack">
        <article className="workspace-card">
          <div className="workspace-runner-field workspace-prometheus-url-field">
            <input
              aria-label="GraphDB base URL"
              className="workspace-input workspace-prometheus-url-input"
              id="graphdb-base-url"
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
              placeholder={defaultGraphDbBaseUrl}
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
      <label className="workspace-label" htmlFor="kg-name-suffix">
        Create new KG with name
      </label>
      <div className="workspace-kg-name-stack">
        <span className="workspace-kg-name-prefix">{kgNamePrefix}</span>
        <div className="workspace-inline-row">
          <input
            aria-label="Knowledge graph name suffix"
            className="workspace-input workspace-share-as-name-input workspace-kg-name-input"
            id="kg-name-suffix"
            onChange={(event) => setNameSuffix(event.target.value)}
            type="text"
            value={nameSuffix}
          />
          <button
            className="workspace-button workspace-button-secondary"
            disabled={isCreating}
            onClick={() => void handleCreate()}
            type="button"
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
      {createError ? (
        <p aria-live="polite" className="workspace-hint">
          {createError}
        </p>
      ) : null}
      <div className="workspace-stack">
        {targets.length === 0 ? (
          <article className="workspace-card">
            <strong>No knowledge graph targets yet</strong>
            <p>Create a repository and named graph for the selected domain.</p>
          </article>
        ) : null}
        {targets.map((target) => (
          <article className="workspace-card" key={target.id}>
            <div className="workspace-heading-row">
              <strong>{target.repositoryId}</strong>
              <div className="workspace-kg-target-actions">
                <button
                  aria-label={`Empty ${target.repositoryId}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action"
                  disabled={emptyingTargetId === target.id || deletingTargetId === target.id}
                  onClick={() => void handleEmpty(target)}
                  title="Empty KG: clear all triples; repository stays registered"
                  type="button"
                >
                  {emptyingTargetId === target.id ? "Emptying..." : <EmptyKgIcon />}
                </button>
                <button
                  aria-label={`Delete ${target.repositoryId}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action"
                  disabled={deletingTargetId === target.id || emptyingTargetId === target.id}
                  onClick={() => void handleDelete(target)}
                  title="Delete repo: remove GraphDB repository and local target"
                  type="button"
                >
                  {deletingTargetId === target.id ? "Deleting..." : <DeleteRepoIcon />}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
