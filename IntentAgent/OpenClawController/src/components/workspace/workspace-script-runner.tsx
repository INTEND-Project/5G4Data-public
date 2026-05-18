"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ScriptEditor } from "@/components/editor/script-editor";
import { IntentGenSessionDialog } from "@/components/workspace/intent-gen-session-dialog";
import {
  defaultScriptName,
  useWorkspaceScriptSession,
} from "@/components/workspace/workspace-script-session-context";
import { analyzeScript } from "@/lib/dsl/analysis/analyze-script";
import type { CreateIntentStatement, ExtractMetricCatalogStatement } from "@/lib/dsl/types";

type WorkspaceScriptRunnerProps = {
  metricNames: string[];
  scriptsApiUrl: string;
  kgTargetsApiBaseUrl: string;
  kgTargets: Array<{ id: string; displayName: string }>;
  discoverIntentAgentApiUrl: string;
  a2aMessageSendUrl: string;
};

const EDITOR_HEIGHT_STORAGE_KEY = "openclaw-workspace-editor-height-px";
const DEFAULT_EDITOR_HEIGHT = 360;
const MIN_EDITOR_HEIGHT = 140;
const MAX_EDITOR_HEIGHT = 960;

function readStoredEditorHeight(): number {
  if (typeof window === "undefined") {
    return DEFAULT_EDITOR_HEIGHT;
  }
  const raw = window.localStorage.getItem(EDITOR_HEIGHT_STORAGE_KEY);
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_EDITOR_HEIGHT;
  }
  return Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, n));
}

export function WorkspaceScriptRunner({
  metricNames,
  scriptsApiUrl,
  kgTargetsApiBaseUrl,
  kgTargets,
  discoverIntentAgentApiUrl,
  a2aMessageSendUrl,
}: WorkspaceScriptRunnerProps) {
  const router = useRouter();
  const {
    selectedDomain,
    activeContent,
    activeScriptId,
    activeScriptName,
    activeTabKey,
    openTabs,
    setActiveContent,
    selectTab,
    closeTab,
    openScriptTab,
    migrateDraftTabToSavedScript,
    clearDirtyForKeys,
    selectedRunLogLines,
    appendRunnerLog,
    beginScriptRun,
    endActiveScriptRun,
    runLogDialogOpen,
    closeRunLogDialog,
  } = useWorkspaceScriptSession();

  const [editorHeightPx, setEditorHeightPx] = useState(DEFAULT_EDITOR_HEIGHT);
  const editorHeightPxRef = useRef(editorHeightPx);

  useEffect(() => {
    setEditorHeightPx(readStoredEditorHeight());
  }, []);

  useEffect(() => {
    editorHeightPxRef.current = editorHeightPx;
  }, [editorHeightPx]);

  const onEditorHeightResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startH = editorHeightPxRef.current;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const next = Math.min(
          MAX_EDITOR_HEIGHT,
          Math.max(MIN_EDITOR_HEIGHT, startH + delta),
        );
        setEditorHeightPx(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try {
          window.localStorage.setItem(
            EDITOR_HEIGHT_STORAGE_KEY,
            String(editorHeightPxRef.current),
          );
        } catch {
          /* ignore */
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [],
  );

  const scriptNameRef = useRef(activeScriptName);
  scriptNameRef.current = activeScriptName;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsScriptName, setSaveAsScriptName] = useState("");
  const [saveAsError, setSaveAsError] = useState<string | null>(null);

  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const saveAsDialogOpenRef = useRef(false);

  useEffect(() => {
    saveAsDialogOpenRef.current = saveAsDialogOpen;
  }, [saveAsDialogOpen]);

  useEffect(() => {
    if (!saveAsDialogOpen) {
      setSaveAsScriptName(activeScriptName);
    }
  }, [activeScriptName, activeTabKey, saveAsDialogOpen]);

  useEffect(() => {
    if (!saveAsDialogOpen) {
      return;
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) {
        return;
      }
      event.preventDefault();
      setSaveAsDialogOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [saveAsDialogOpen, saving]);

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
  }, [runLogDialogOpen, closeRunLogDialog]);

  useEffect(() => {
    if (!saveAsDialogOpen) {
      return;
    }
    saveAsInputRef.current?.focus();
    saveAsInputRef.current?.select();
  }, [saveAsDialogOpen]);

  const savingLockRef = useRef(false);

  const submitSave = useCallback(
    async (nameInput: string) => {
      const trimmedName = nameInput.trim();
      if (!trimmedName) {
        setSaveError("Script name is required.");
        if (saveAsDialogOpenRef.current) {
          setSaveAsError("Enter a script name.");
        }
        return false;
      }

      if (savingLockRef.current) {
        return false;
      }
      savingLockRef.current = true;
      setSaveError(null);
      setSaveAsError(null);
      setSaving(true);

      const fail = async (response: Response, fallback: string) => {
        const body = await response.json().catch(() => ({}));
        const message =
          typeof body?.error === "string"
            ? body.error
            : `${fallback} (${response.status})`;
        setSaveError(message);
        if (saveAsDialogOpenRef.current) {
          setSaveAsError(message);
        }
      };

      try {
        if (!activeScriptId) {
          const response = await fetch(scriptsApiUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              domain: selectedDomain,
              name: trimmedName,
              content: activeContent,
            }),
          });
          if (!response.ok) {
            await fail(response, "Save failed");
            return false;
          }
          const data = (await response.json()) as {
            script?: { id: string; name: string };
          };
          const newId = data.script?.id;
          const newName = data.script?.name ?? trimmedName;
          if (newId) {
            migrateDraftTabToSavedScript(newId, newName);
          }
          scriptNameRef.current = trimmedName;
          clearDirtyForKeys([activeTabKey]);
          router.refresh();
          return true;
        }

        if (trimmedName === activeScriptName.trim()) {
          const response = await fetch(
            `${scriptsApiUrl}/${encodeURIComponent(activeScriptId)}`,
            {
              method: "PATCH",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                content: activeContent,
                name: trimmedName,
              }),
            },
          );
          if (!response.ok) {
            await fail(response, "Save failed");
            return false;
          }
          scriptNameRef.current = trimmedName;
          clearDirtyForKeys([activeTabKey]);
          router.refresh();
          return true;
        }

        const response = await fetch(scriptsApiUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            domain: selectedDomain,
            name: trimmedName,
            content: activeContent,
          }),
        });
        if (!response.ok) {
          await fail(response, "Save failed");
          return false;
        }
        const data = (await response.json()) as {
          script?: { id: string; name: string };
        };
        const created = data.script;
        if (!created?.id) {
          const message = "Save failed: server did not return a script id.";
          setSaveError(message);
          if (saveAsDialogOpenRef.current) {
            setSaveAsError(message);
          }
          return false;
        }
        openScriptTab({
          id: created.id,
          name: created.name ?? trimmedName,
          content: activeContent,
        });
        router.refresh();
        return true;
      } finally {
        savingLockRef.current = false;
        setSaving(false);
      }
    },
    [
      activeScriptId,
      activeScriptName,
      activeContent,
      activeTabKey,
      scriptsApiUrl,
      selectedDomain,
      router,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
      openScriptTab,
    ],
  );

  const openSaveAsDialog = useCallback(() => {
    setSaveAsError(null);
    setSaveAsScriptName(activeScriptName);
    setSaveAsDialogOpen(true);
  }, [activeScriptName]);

  const confirmSaveAsFromDialog = useCallback(async () => {
    setSaveAsError(null);
    const ok = await submitSave(saveAsScriptName);
    if (ok) {
      setSaveAsDialogOpen(false);
    }
  }, [saveAsScriptName, submitSave]);

  const quickSave = useCallback(() => {
    const fallback = defaultScriptName(selectedDomain);
    const name = scriptNameRef.current.trim() || fallback;
    void submitSave(name);
  }, [submitSave, selectedDomain]);

  const quickSaveRef = useRef(quickSave);
  quickSaveRef.current = quickSave;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "s") {
        return;
      }
      event.preventDefault();
      void quickSaveRef.current();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  const runnerKgTargets =
    kgTargets.length > 0
      ? kgTargets
      : [{ id: "", displayName: "kg-avalanche-demo" }];

  const [selectedKgTargetId, setSelectedKgTargetId] = useState("");

  useEffect(() => {
    if (kgTargets.length === 0) {
      setSelectedKgTargetId("");
      return;
    }
    setSelectedKgTargetId((prev) =>
      prev && kgTargets.some((t) => t.id === prev) ? prev : kgTargets[0].id,
    );
  }, [kgTargets]);

  const persistIntentStoreUrl =
    selectedKgTargetId.length > 0 && kgTargetsApiBaseUrl.trim().length > 0
      ? `${kgTargetsApiBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(selectedKgTargetId)}/store-intent`
      : null;

  const intentFinishRef = useRef<(() => void) | null>(null);
  /** Maps DSL intent alias (`as` from create-intent) → canonical kg intent id (`I…`) after successful ingest. */
  const intentIdByAliasRef = useRef(new Map<string, string>());
  const [runBusy, setRunBusy] = useState(false);
  const [intentSession, setIntentSession] = useState<{
    wellKnownURI: string;
    prompt: string;
    intentArtifactLabel: string;
  } | null>(null);

  const handleKgIntentStored = useCallback((_dslAlias: string, canonicalIntentId: string) => {
    intentIdByAliasRef.current.set(_dslAlias, canonicalIntentId);
  }, []);

  const handleRunScript = useCallback(async () => {
    beginScriptRun(activeScriptName);
    try {
      appendRunnerLog("Run Script: analysing DSL…");

      const { statements, diagnostics } = analyzeScript(activeContent);

      for (const diagnostic of diagnostics.filter(
        (diag) => diag.severity === "error",
      )) {
        appendRunnerLog(
          `[line ${diagnostic.line}, ${diagnostic.code}] ${diagnostic.message}`,
        );
      }

      if (diagnostics.some((diag) => diag.severity === "error")) {
        appendRunnerLog("Stopping: resolve validation errors first.");
        return;
      }

      const orderedStatements = [...statements].sort((a, b) => a.line - b.line);

      appendRunnerLog("Run Script: executing supported statements in order.");

      intentIdByAliasRef.current.clear();
      const catalogBindings = new Map<string, string[]>();

      const bindings = new Map<string, string>();
      let lastWorkspaceIntentWellKnownUri: string | null = null;
      let memoizedIntentAgentWellKnownUri: string | undefined;

      const lookupIntentGeneratingAgentUri = async (): Promise<
        string | null
      > => {
        if (memoizedIntentAgentWellKnownUri) {
          return memoizedIntentAgentWellKnownUri;
        }

        const response = await fetch(discoverIntentAgentApiUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domain: selectedDomain }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          agent?: { wellKnownURI?: string };
        };

        const uriCandidate =
          response.ok &&
          typeof body.agent?.wellKnownURI === "string" &&
          body.agent.wellKnownURI.length > 0
            ? body.agent.wellKnownURI
            : null;

        if (!uriCandidate) {
          appendRunnerLog(
            typeof body.error === "string" && body.error.length > 0
              ? body.error
              : `Discovery request failed (${response.status}).`,
          );
          return null;
        }

        memoizedIntentAgentWellKnownUri = uriCandidate;

        return uriCandidate;
      };

      for (const statement of orderedStatements) {
        if (statement.kind === "discover-intent-workspace-domain") {
          appendRunnerLog(`Line ${statement.line}: Searching registry…`);
          const uri = await lookupIntentGeneratingAgentUri();
          if (!uri) {
            appendRunnerLog(
              "Could not locate an intent-generating agent card for this domain.",
            );
            return;
          }

          bindings.set(statement.alias, uri);
          lastWorkspaceIntentWellKnownUri = uri;

          appendRunnerLog(
            `Line ${statement.line}: ${statement.alias} → ${uri}`,
          );
          continue;
        }

        if (statement.kind === "create-intent") {
          const stmt: CreateIntentStatement = statement;

          let resolved =
            bindings.get(stmt.agentAlias) ??
            (stmt.agentAlias === "intentGen"
              ? lastWorkspaceIntentWellKnownUri
              : null);

          if (!resolved && stmt.agentAlias === "intentGen") {
            resolved = await lookupIntentGeneratingAgentUri();
            if (!resolved) {
              appendRunnerLog(
                `Line ${statement.line}: intentGen shortcut needs a reachable intent-generating agent for ${selectedDomain}.`,
              );
              return;
            }
          }

          if (!resolved) {
            appendRunnerLog(
              `Line ${statement.line}: Unable to bind agent card URI for "${stmt.agentAlias}".`,
            );
            return;
          }

          appendRunnerLog(`Run Script: create intent as "${stmt.intentAlias}".`);
          appendRunnerLog(
            `Line ${statement.line}: Opening A2A session for intent alias "${stmt.intentAlias}".`,
          );
          appendRunnerLog(
            `Conversation uses a single persistent task/context pair; reuse them as you iterate with Send.`,
          );
          if (!persistIntentStoreUrl) {
            appendRunnerLog(
              "Intent Turtle will not be stored: choose or create a knowledge graph target in the sidebar.",
            );
          }

          await new Promise<void>((finish) => {
            intentFinishRef.current = finish;
            setIntentSession({
              intentArtifactLabel: stmt.intentAlias,
              prompt: stmt.prompt,
              wellKnownURI: resolved,
            });
          });
          continue;
        }

        if (statement.kind === "extract-metric-catalog") {
          const stmt: ExtractMetricCatalogStatement = statement;

          if (!selectedKgTargetId || !kgTargetsApiBaseUrl.trim()) {
            appendRunnerLog(
              `Line ${statement.line}: extract metric-catalog requires a knowledge graph target in the runner (same as intent storage).`,
            );
            return;
          }

          const canonicalId = intentIdByAliasRef.current.get(stmt.intentAlias);
          if (!canonicalId) {
            appendRunnerLog(
              `Line ${statement.line}: No stored intent id for alias "${stmt.intentAlias}". Store intent Turtle to the selected knowledge graph target (wait for a successful ingest) before extracting the metric catalog.`,
            );
            return;
          }

          const base = kgTargetsApiBaseUrl.replace(/\/+$/, "");
          const mcUrl = `${base}/${encodeURIComponent(selectedKgTargetId)}/metric-catalog`;

          const response = await fetch(mcUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ intentLocalId: canonicalId }),
          });

          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
            metricNames?: string[];
          };

          if (!response.ok) {
            appendRunnerLog(
              typeof data.error === "string" && data.error.length > 0
                ? `Line ${statement.line}: metric-catalog request failed: ${data.error}`
                : `Line ${statement.line}: metric-catalog request failed (${response.status}).`,
            );
            return;
          }

          const metricNames = Array.isArray(data.metricNames) ? data.metricNames : [];
          catalogBindings.set(stmt.metricCatalogAlias, metricNames);

          const preview =
            metricNames.length <= 24
              ? metricNames.join(", ")
              : `${metricNames.slice(0, 24).join(", ")} … (+${metricNames.length - 24} more)`;
          appendRunnerLog(
            `Run Script: extract metric-catalog as "${stmt.metricCatalogAlias}" for intent ${canonicalId} (${metricNames.length} names): ${preview || "(none)"}`,
          );
          continue;
        }
      }

      if (catalogBindings.size > 0) {
        appendRunnerLog(
          `Run Script: metric-catalog list aliases bound: ${Array.from(catalogBindings.keys()).join(", ")}.`,
        );
      }

      appendRunnerLog("Run Script: finished scripted steps.");
    } finally {
      endActiveScriptRun();
    }
  }, [
    activeContent,
    activeScriptName,
    appendRunnerLog,
    beginScriptRun,
    endActiveScriptRun,
    discoverIntentAgentApiUrl,
    kgTargetsApiBaseUrl,
    persistIntentStoreUrl,
    selectedDomain,
    selectedKgTargetId,
  ]);

  const handleIntentDialogFinish = useCallback(() => {
    intentFinishRef.current?.();
    intentFinishRef.current = null;
    setIntentSession(null);
  }, []);

  const kickOffRunScript = useCallback(() => {
    if (runBusy) {
      return;
    }

    void (async () => {
      setRunBusy(true);
      try {
        await handleRunScript();
      } finally {
        setRunBusy(false);
      }
    })();
  }, [handleRunScript, runBusy]);

  return (
    <>
      {openTabs.length >= 2 ? (
        <div
          aria-label="Open scripts"
          className="workspace-editor-tabs"
          role="tablist"
        >
          {openTabs.map((tab) => {
            const selected = tab.tabKey === activeTabKey;
            return (
              <div
                className={`workspace-editor-tab ${selected ? "workspace-editor-tab-active" : ""}`}
                key={tab.tabKey}
              >
                <button
                  aria-selected={selected}
                  className="workspace-editor-tab-label"
                  onClick={() => selectTab(tab.tabKey)}
                  role="tab"
                  title={tab.name}
                  type="button"
                >
                  <span className="workspace-editor-tab-text">{tab.name}</span>
                </button>
                <button
                  aria-label={`Close ${tab.name}`}
                  className="workspace-editor-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.tabKey);
                  }}
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="workspace-editor-resize-block">
        <ScriptEditor
          heightPx={editorHeightPx}
          key={activeTabKey}
          metricNames={metricNames}
          onChange={setActiveContent}
          onSave={() => void quickSaveRef.current()}
          value={activeContent}
        />
        <div
          aria-label="Resize editor height"
          aria-orientation="horizontal"
          className="workspace-editor-height-resizer"
          onMouseDown={onEditorHeightResizeMouseDown}
          role="separator"
        />
      </div>
      <div className="workspace-runner">
        <div className="workspace-runner-field">
          <label className="workspace-label">Run mode</label>
          <div className="workspace-runner-modes">
            <span className="workspace-runner-mode workspace-runner-mode-active">
              dry-run
            </span>
            <span className="workspace-runner-mode">execute</span>
          </div>
        </div>
        <div className="workspace-runner-field">
          <label className="workspace-label" htmlFor="runner-kg-target">
            Knowledge graph target
          </label>
          <select
            className="workspace-select workspace-runner-select"
            disabled={runnerKgTargets.length === 1 && runnerKgTargets[0]?.id === ""}
            id="runner-kg-target"
            onChange={(event) => setSelectedKgTargetId(event.target.value)}
            value={
              runnerKgTargets.some((t) => t.id === selectedKgTargetId)
                ? selectedKgTargetId
                : runnerKgTargets[0]?.id ?? ""
            }
          >
            {runnerKgTargets.map((target) => (
              <option key={target.id || target.displayName} value={target.id}>
                {target.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="workspace-runner-field">
          <label className="workspace-label" htmlFor="runner-result-policy">
            Run result policy
          </label>
          <select
            className="workspace-select workspace-runner-select"
            defaultValue="stop on first error"
            id="runner-result-policy"
          >
            <option value="stop on first error">stop on first error</option>
            <option value="continue with warnings">
              continue with warnings
            </option>
          </select>
        </div>
        <div className="workspace-runner-actions">
          <button
            className="workspace-button workspace-runner-button"
            disabled={runBusy}
            onClick={kickOffRunScript}
            type="button"
          >
            {runBusy ? "Running…" : "Run Script"}
          </button>
          <button
            className="workspace-button workspace-runner-button"
            disabled={saving}
            onClick={openSaveAsDialog}
            type="button"
          >
            {saving ? "Saving…" : "Save As"}
          </button>
        </div>
      </div>
      {saveError ? (
        <p className="workspace-save-error" role="alert">
          {saveError}
        </p>
      ) : null}

      {saveAsDialogOpen ? (
        <div
          className="workspace-save-name-dialog-backdrop"
          onClick={() => {
            if (!saving) {
              setSaveAsDialogOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            aria-labelledby="workspace-save-as-dialog-title"
            aria-modal="true"
            className="workspace-save-name-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h3 id="workspace-save-as-dialog-title">Save script</h3>
            <p className="workspace-save-as-dialog-hint">
              Keep the current file name to update this script. Change the name
              to create a new script and open it in a new tab.
            </p>
            <div>
              <label
                className="workspace-label"
                htmlFor="workspace-save-as-script-name"
              >
                Script file name
              </label>
              <input
                ref={saveAsInputRef}
                autoComplete="off"
                className="workspace-input workspace-save-name-input"
                id="workspace-save-as-script-name"
                onChange={(event) => setSaveAsScriptName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void confirmSaveAsFromDialog();
                  }
                }}
                type="text"
                value={saveAsScriptName}
              />
            </div>
            {saveAsError ? (
              <p className="workspace-save-name-dialog-error" role="alert">
                {saveAsError}
              </p>
            ) : null}
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button"
                disabled={saving}
                onClick={() => setSaveAsDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="workspace-button"
                disabled={saving}
                onClick={() => void confirmSaveAsFromDialog()}
                type="button"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {runLogDialogOpen ? (
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
              Output for the run selected in the top bar (up to the last 10
              script runs).
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
                  <p
                    className="workspace-runner-log-entry"
                    key={`runner-dialog-${index}`}
                  >
                    {line}
                  </p>
                ))
              )}
            </div>
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button"
                onClick={closeRunLogDialog}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <IntentGenSessionDialog
        a2aMessageSendUrl={a2aMessageSendUrl}
        agentCardWellKnownURI={intentSession?.wellKnownURI ?? ""}
        intentArtifactLabel={intentSession?.intentArtifactLabel ?? ""}
        onFinished={handleIntentDialogFinish}
        onIntentPersistLog={appendRunnerLog}
        onKgIntentStored={handleKgIntentStored}
        open={intentSession !== null}
        persistIntentStoreUrl={persistIntentStoreUrl}
        seedPrompt={intentSession?.prompt ?? null}
      />
    </>
  );
}
