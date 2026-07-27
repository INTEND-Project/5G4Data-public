"use client";

import {
  formatScriptRunListLabel,
  useWorkspaceScriptSession,
} from "@/components/workspace/workspace-script-session-context";

function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      className="workspace-script-delete-icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function WorkspaceRunIdChip() {
  const {
    deleteAllScriptRunLogs,
    deleteSelectedScriptRunLog,
    openRunLogDialog,
    scriptRunLogs,
    selectedScriptRunId,
    setSelectedScriptRunId,
  } = useWorkspaceScriptSession();

  const selectValue = selectedScriptRunId ?? scriptRunLogs[0]?.id ?? "";

  if (scriptRunLogs.length === 0) {
    return (
      <div className="workspace-run-history-controls">
        <select
          aria-label="Run script history"
          className="workspace-chip workspace-script-run-select"
          disabled
          title="No script runs yet"
        >
          <option value="">No script runs yet</option>
        </select>
        <button
          aria-label="Open run script log"
          className="workspace-chip workspace-run-log-open-button"
          disabled
          title="No script runs yet"
          type="button"
        >
          Show selected log
        </button>
        <button
          aria-label="Delete selected run script log"
          className="workspace-run-log-delete-selected"
          disabled
          title="No script runs yet"
          type="button"
        >
          <TrashIcon size={14} />
        </button>
        <button
          aria-label="Delete all run script logs"
          className="workspace-script-delete"
          disabled
          title="No script runs yet"
          type="button"
        >
          <TrashIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="workspace-run-history-controls">
      <select
        aria-label="Run script history"
        className="workspace-chip workspace-script-run-select"
        id="workspace-script-run-history"
        onChange={(event) => setSelectedScriptRunId(event.target.value)}
        title="Last 10 Run Script executions (newest first). Choose one to inspect in the log."
        value={selectValue}
      >
        {scriptRunLogs.map((run) => (
          <option key={run.id} value={run.id}>
            {formatScriptRunListLabel(run.scriptName, run.startedAt)}
          </option>
        ))}
      </select>
      <button
        aria-label="Open run script log"
        className="workspace-chip workspace-run-log-open-button"
        onClick={openRunLogDialog}
        type="button"
      >
        Show selected log
      </button>
      <button
        aria-label="Delete selected run script log"
        className="workspace-run-log-delete-selected"
        disabled={!selectValue}
        onClick={() => {
          void deleteSelectedScriptRunLog();
        }}
        title="Delete selected log"
        type="button"
      >
        <TrashIcon size={14} />
      </button>
      <button
        aria-label="Delete all run script logs"
        className="workspace-script-delete"
        onClick={() => {
          void deleteAllScriptRunLogs();
        }}
        title="Delete all run script logs"
        type="button"
      >
        <TrashIcon />
      </button>
    </div>
  );
}
