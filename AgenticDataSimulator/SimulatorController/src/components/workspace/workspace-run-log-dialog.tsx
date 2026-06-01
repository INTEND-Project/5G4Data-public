"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  useWorkspaceRunLogUi,
  useWorkspaceScriptSession,
} from "@/components/workspace/workspace-script-session-context";

const SIZE_STORAGE_KEY = "openclaw-workspace-run-log-dialog-size";
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 960;

type RunLogDialogSize = {
  width: number;
  height: number;
};

function clampDialogSize(size: RunLogDialogSize): RunLogDialogSize {
  const maxWidth =
    typeof window === "undefined"
      ? MAX_WIDTH
      : Math.min(MAX_WIDTH, window.innerWidth - 48);
  const maxHeight =
    typeof window === "undefined"
      ? MAX_HEIGHT
      : Math.min(MAX_HEIGHT, window.innerHeight - 48);

  return {
    width: Math.min(maxWidth, Math.max(MIN_WIDTH, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_HEIGHT, size.height)),
  };
}

function readStoredDialogSize(): RunLogDialogSize {
  if (typeof window === "undefined") {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }

  const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
  if (!raw) {
    return clampDialogSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RunLogDialogSize>;
    const width =
      typeof parsed.width === "number" && Number.isFinite(parsed.width)
        ? parsed.width
        : DEFAULT_WIDTH;
    const height =
      typeof parsed.height === "number" && Number.isFinite(parsed.height)
        ? parsed.height
        : DEFAULT_HEIGHT;
    return clampDialogSize({ width, height });
  } catch {
    return clampDialogSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  }
}

export const WorkspaceRunLogDialog = memo(function WorkspaceRunLogDialog() {
  const { closeRunLogDialog } = useWorkspaceScriptSession();
  const { runLogDialogOpen, selectedRunLogLines } = useWorkspaceRunLogUi();
  const [dialogSize, setDialogSize] = useState<RunLogDialogSize>(() =>
    clampDialogSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }),
  );
  const dialogSizeRef = useRef(dialogSize);

  useEffect(() => {
    if (!runLogDialogOpen) {
      return;
    }
    setDialogSize(readStoredDialogSize());
  }, [runLogDialogOpen]);

  useEffect(() => {
    dialogSizeRef.current = dialogSize;
  }, [dialogSize]);

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

  const onDialogResizeMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = dialogSizeRef.current;

    const onMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      setDialogSize(
        clampDialogSize({
          width: startSize.width + deltaX,
          height: startSize.height + deltaY,
        }),
      );
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(
          SIZE_STORAGE_KEY,
          JSON.stringify(dialogSizeRef.current),
        );
      } catch {
        /* ignore quota / private mode */
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

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
        style={{
          width: dialogSize.width,
          height: dialogSize.height,
        }}
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
        <div
          aria-label="Resize run script log dialog"
          className="workspace-run-log-dialog-resizer"
          onMouseDown={onDialogResizeMouseDown}
          role="separator"
        />
      </div>
    </div>
  );
});
