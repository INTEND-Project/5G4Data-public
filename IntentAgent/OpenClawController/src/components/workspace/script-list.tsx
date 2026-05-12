"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";

type ScriptListProps = {
  scriptsApiUrl: string;
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

export function ScriptList({ scriptsApiUrl }: ScriptListProps) {
  const router = useRouter();
  const { scriptsFromServer, activeScriptId, openScriptTab } = useWorkspaceScriptSession();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
        router.refresh();
      } finally {
        setDeletingId(null);
      }
    },
    [scriptsApiUrl, router],
  );

  return (
    <div className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Scripts</h2>
        <span className="workspace-chip">{scriptsFromServer.length} scripts</span>
      </div>
      <div className="workspace-stack">
        {scriptsFromServer.length === 0 ? (
          <article className="workspace-card">
            <strong>No scripts yet</strong>
            <p>Create a script in the selected domain to start stage 1 authoring.</p>
          </article>
        ) : null}
        {scriptsFromServer.map((script) => (
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
              </button>
              <button
                aria-label={`Delete ${script.name}`}
                className="workspace-script-delete"
                disabled={deletingId === script.id}
                onClick={() => void handleDelete(script)}
                title="Delete script"
                type="button"
              >
                <TrashIcon />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
