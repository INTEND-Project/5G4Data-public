"use client";

import {
  formatScriptRunListLabel,
  useWorkspaceScriptSession,
} from "@/components/workspace/workspace-script-session-context";

export function WorkspaceRunIdChip() {
  const { openRunLogDialog, scriptRunLogs, selectedScriptRunId, setSelectedScriptRunId } =
    useWorkspaceScriptSession();

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
    </div>
  );
}
