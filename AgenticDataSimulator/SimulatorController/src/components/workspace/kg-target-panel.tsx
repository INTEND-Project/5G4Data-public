"use client";

import { useEffect, useState } from "react";

type KgTargetPanelProps = {
  selectedDomain: string;
  createUrl: string;
  deleteUrlBase: string;
  graphDbConnected: boolean;
  targets: Array<{
    id: string;
    displayName: string;
    repositoryId: string;
    graphIri: string;
  }>;
};

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
  createUrl,
  deleteUrlBase,
  graphDbConnected,
  targets,
}: KgTargetPanelProps) {
  const [displayName, setDisplayName] = useState("kg-avalanche-demo");
  const [displayedTargets, setDisplayedTargets] = useState(targets);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null);
  const [emptyingTargetId, setEmptyingTargetId] = useState<string | null>(null);

  useEffect(() => {
    setDisplayedTargets(targets);
  }, [targets]);

  async function handleCreate() {
    const trimmedName = displayName.trim();

    if (!trimmedName) {
      setCreateError("Enter a knowledge graph name first.");
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

      setDisplayedTargets((currentTargets) => [payload.target, ...currentTargets]);
      setDisplayName("");
    } catch (error) {
      console.error(error);
      setCreateError("Unable to create the knowledge graph target right now.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleEmpty(target: { id: string; displayName: string }) {
    if (
      !window.confirm(
        `Empty all triples in ${target.displayName}? The GraphDB repository and named graph will remain.`,
      )
    ) {
      return;
    }

    setEmptyingTargetId(target.id);
    setCreateError(null);

    try {
      const response = await fetch(`${deleteUrlBase}/${target.id}/empty`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`KG empty failed with ${response.status}`);
      }
    } catch (error) {
      console.error(error);
      setCreateError("Unable to empty the knowledge graph right now.");
    } finally {
      setEmptyingTargetId(null);
    }
  }

  async function handleDelete(target: { id: string; displayName: string }) {
    if (
      !window.confirm(
        `Delete ${target.displayName} and remove its GraphDB repository? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingTargetId(target.id);
    setCreateError(null);

    try {
      const response = await fetch(`${deleteUrlBase}/${target.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`KG deletion failed with ${response.status}`);
      }

      setDisplayedTargets((currentTargets) =>
        currentTargets.filter((currentTarget) => currentTarget.id !== target.id),
      );
    } catch (error) {
      console.error(error);
      setCreateError("Unable to delete the knowledge graph target right now.");
    } finally {
      setDeletingTargetId(null);
    }
  }

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>KG target</h2>
        <span
          className={`workspace-chip ${
            graphDbConnected ? "workspace-chip-live" : "workspace-chip-down"
          }`}
        >
          GraphDB
        </span>
      </div>
      <label className="workspace-label" htmlFor="kg-name">
        Create new KG with name
      </label>
      <div className="workspace-inline-row">
        <input
          className="workspace-input"
          aria-label="Create new KG with name"
          id="kg-name"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
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
      {createError ? (
        <p aria-live="polite" className="workspace-hint">
          {createError}
        </p>
      ) : null}
      <div className="workspace-stack">
        {displayedTargets.length === 0 ? (
          <article className="workspace-card">
            <strong>No knowledge graph targets yet</strong>
            <p>Create a repository and named graph for the selected domain.</p>
          </article>
        ) : null}
        {displayedTargets.map((target) => (
          <article className="workspace-card" key={target.id}>
            <div className="workspace-heading-row">
              <strong>{target.displayName}</strong>
              <div className="workspace-kg-target-actions">
                <button
                  aria-label={`Empty ${target.displayName}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action"
                  disabled={emptyingTargetId === target.id || deletingTargetId === target.id}
                  onClick={() => void handleEmpty(target)}
                  title="Empty KG: clear all triples; repository stays registered"
                  type="button"
                >
                  {emptyingTargetId === target.id ? "Emptying..." : <EmptyKgIcon />}
                </button>
                <button
                  aria-label={`Delete ${target.displayName}`}
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
            <p>{target.repositoryId}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
