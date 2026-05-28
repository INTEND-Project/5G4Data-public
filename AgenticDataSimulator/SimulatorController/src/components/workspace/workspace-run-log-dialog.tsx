"use client";

import { memo, useEffect } from "react";

import {
  useWorkspaceRunLogUi,
  useWorkspaceScriptSession,
} from "@/components/workspace/workspace-script-session-context";

export const WorkspaceRunLogDialog = memo(function WorkspaceRunLogDialog() {
  const { closeRunLogDialog } = useWorkspaceScriptSession();
  const { runLogDialogOpen, selectedRunLogLines } = useWorkspaceRunLogUi();

  useEffect(() => {
    if (!runLogDialogOpen) {
      return;
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeRunLogDialog();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [closeRunLogDialog, runLogDialogOpen]);

  if (!runLogDialogOpen) {
    return null;
  }

  return (
    <div
      className="workspace-save-name-dialog-backdrop"
      onClick={closeRunLogDialog}
      role="presentation"
    >
      <div
        aria-labelledby="workspace-run-log-dialog-title"
        aria-modal="true"
        className="workspace-run-log-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="workspace-run-log-dialog-title">Run script log</h3>
        <p className="workspace-save-as-dialog-hint">
          Output for the run selected in the top bar (up to the last 10 script runs).
        </p>
        <div
          aria-label="Run script output"
          className="workspace-runner-log workspace-run-log-dialog-body"
          role="log"
        >
          {selectedRunLogLines.length === 0 ? (
            <p className="workspace-runner-log-empty">
              No script run output for this selection.
            </p>
          ) : (
            selectedRunLogLines.map((line, index) => (
              <p className="workspace-runner-log-entry" key={`runner-dialog-${index}`}>
                {line}
              </p>
            ))
          )}
        </div>
        <div className="workspace-save-name-dialog-actions">
          <button className="workspace-button" onClick={closeRunLogDialog} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
});
