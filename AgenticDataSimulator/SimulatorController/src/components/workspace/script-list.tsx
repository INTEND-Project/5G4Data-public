"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useWorkspaceScriptSession,
  type ServerScript,
} from "@/components/workspace/workspace-script-session-context";
import {
  sortScripts,
  type ScriptListSortMode,
} from "@/lib/scripts/sort-scripts";

type ScriptListProps = {
  scriptsApiUrl: string;
  currentUserId: string;
};

function TrashIcon() {
  return (
    <svg
      aria-hidden
      className="workspace-script-delete-icon"
      fill="none"
      height={18}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      width={18}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function ScriptList({ scriptsApiUrl, currentUserId }: ScriptListProps) {
  const {
    scriptsFromServer,
    selectedDomain,
    activeScriptId,
    openScriptTab,
    removeScriptFromList,
    replaceServerScripts,
  } = useWorkspaceScriptSession();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<ScriptListSortMode>("name");
  const [displayedScripts, setDisplayedScripts] = useState(scriptsFromServer);
  const visibleScripts = useMemo(
    () => sortScripts(displayedScripts, sortMode),
    [displayedScripts, sortMode],
  );

  useEffect(() => {
    setDisplayedScripts(scriptsFromServer);
  }, [scriptsFromServer]);

  const handleDelete = useCallback(
    async (script: { id: string; name: string }) => {
      if (
        !window.confirm(`Delete script "${script.name}"? This cannot be undone.`)
      ) {
        return;
      }
      setDeletingId(script.id);
      try {
        const response = await fetch(
          `${scriptsApiUrl}/${encodeURIComponent(script.id)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message =
            typeof body?.error === "string"
              ? body.error
              : `Delete failed (${response.status})`;
          window.alert(message);
          return;
        }

        setDisplayedScripts((current) =>
          current.filter((entry) => entry.id !== script.id),
        );
        removeScriptFromList(script.id);

        try {
          const listResponse = await fetch(
            `${scriptsApiUrl}?${new URLSearchParams({ domain: selectedDomain }).toString()}`,
            { credentials: "same-origin", cache: "no-store" },
          );
          if (listResponse.ok) {
            const body = (await listResponse.json()) as { scripts?: ServerScript[] };
            const refreshed = body.scripts ?? [];
            setDisplayedScripts(refreshed);
            replaceServerScripts(refreshed);
          }
        } catch {
          /* optimistic list update already applied */
        }
      } finally {
        setDeletingId(null);
      }
    },
    [
      scriptsApiUrl,
      selectedDomain,
      removeScriptFromList,
      replaceServerScripts,
    ],
  );

  return (
    <div className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Scripts</h2>
        <div className="workspace-heading-row-end">
          <select
            aria-label="Sort scripts"
            className="workspace-select workspace-select-compact workspace-script-sort"
            onChange={(event) =>
              setSortMode(event.target.value as ScriptListSortMode)
            }
            value={sortMode}
          >
            <option value="name">A–Z</option>
            <option value="created">Newest first</option>
          </select>
          <span className="workspace-chip">{visibleScripts.length} scripts</span>
        </div>
      </div>
      <div className="workspace-stack">
        {visibleScripts.length === 0 ? (
          <article className="workspace-card">
            <strong>No scripts yet</strong>
            <p>Create a script in the selected domain to start stage 1 authoring.</p>
          </article>
        ) : null}
        {visibleScripts.map((script) => {
          const isOwned = script.userId === currentUserId;
          return (
            <article
              className={`workspace-card workspace-card-script ${script.id === activeScriptId ? "workspace-card-active" : ""}`}
              key={script.id}
            >
              <div className="workspace-script-row">
                <button
                  className="workspace-script-open"
                  onClick={() => openScriptTab(script)}
                  title={`Open ${script.name}`}
                  type="button"
                >
                  <span className="workspace-script-name" title={script.name}>
                    {script.name}
                  </span>
                  {script.shared ? (
                    <span className="workspace-chip workspace-script-shared-chip">Shared</span>
                  ) : null}
                  {!isOwned && script.ownerUsername ? (
                    <span className="workspace-script-owner">by {script.ownerUsername}</span>
                  ) : null}
                </button>
                {isOwned ? (
                  <button
                    aria-label={`Delete ${script.name}`}
                    className="workspace-script-delete"
                    disabled={deletingId === script.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(script);
                    }}
                    title="Delete script"
                    type="button"
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
