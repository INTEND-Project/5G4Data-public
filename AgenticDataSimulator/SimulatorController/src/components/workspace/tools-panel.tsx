"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ExtraFunctionalToolSettingsDialog } from "@/components/workspace/extra-functional-tool-settings-dialog";
import { SendIntentToToolDialog } from "@/components/workspace/send-intent-to-tool-dialog";
import { TestSendIntentToToolDialog } from "@/components/workspace/test-send-intent-to-tool-dialog";
import { WorkspaceCollapsibleSection } from "@/components/workspace/workspace-collapsible-section";
import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import { withAppBasePath } from "@/lib/app-paths";
import {
  EXTRA_FUNCTIONAL_TOOLS,
  type ExtraFunctionalToolId,
} from "@/lib/tools/extra-functional-tools";
import {
  readToolTmfUrlPreferencesFromStorage,
  writeToolTmfUrlPreferencesToStorage,
  type ToolTmfUrlPreferencesMap,
} from "@/lib/tools/tool-url-preferences";

type KgTargetRecord = {
  id: string;
  displayName: string;
};

type ToolsPanelProps = {
  selectedKgTargetId: string;
  kgTargets: KgTargetRecord[];
};

type ActiveDialog =
  | { kind: "settings"; toolId: ExtraFunctionalToolId }
  | { kind: "send"; toolId: ExtraFunctionalToolId }
  | { kind: "test-send"; toolId: ExtraFunctionalToolId }
  | null;

type SendUrlError = {
  toolId: ExtraFunctionalToolId;
  toolLabel: string;
};

function ToolConfigureIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34 1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function ToolSendIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M22 2 11 13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="M22 2 15 22 11 13 2 9l20-7Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function ToolTestSendIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path d="M14 2v6h6M10 13h4M10 17h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
    </svg>
  );
}

export function ToolsPanel({ selectedKgTargetId, kgTargets }: ToolsPanelProps) {
  const { graphDbBaseUrl } = useWorkspaceScriptSession();
  const [urlPrefs, setUrlPrefs] = useState<ToolTmfUrlPreferencesMap>(() =>
    readToolTmfUrlPreferencesFromStorage(),
  );
  const [envDefaults, setEnvDefaults] = useState<Partial<Record<ExtraFunctionalToolId, string>>>(
    {},
  );
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [sendUrlError, setSendUrlError] = useState<SendUrlError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(withAppBasePath("/api/tools/defaults"), {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok || cancelled) {
          return;
        }
        const body = (await response.json()) as {
          defaults?: Partial<Record<ExtraFunctionalToolId, string>>;
        };
        if (!cancelled && body.defaults) {
          setEnvDefaults(body.defaults);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTarget = useMemo(
    () => kgTargets.find((target) => target.id === selectedKgTargetId) ?? null,
    [kgTargets, selectedKgTargetId],
  );

  const kgActionsDisabled = !selectedKgTargetId.trim() || kgTargets.length === 0;
  const kgDisabledTitle = kgActionsDisabled
    ? "Select a knowledge graph target in the script editor first."
    : undefined;

  const resolveTmfUrl = useCallback(
    (toolId: ExtraFunctionalToolId) =>
      urlPrefs[toolId]?.trim() || envDefaults[toolId]?.trim() || "",
    [envDefaults, urlPrefs],
  );

  const handleSaveUrl = useCallback((toolId: ExtraFunctionalToolId, url: string) => {
    setUrlPrefs((current) => {
      const next = { ...current };
      if (url.trim()) {
        next[toolId] = url;
      } else {
        delete next[toolId];
      }
      writeToolTmfUrlPreferencesToStorage(next);
      return next;
    });
  }, []);

  const activeTool = EXTRA_FUNCTIONAL_TOOLS.find((tool) => tool.id === activeDialog?.toolId);

  return (
    <>
      <WorkspaceCollapsibleSection
        className="workspace-tools-section"
        sectionId="tools"
        title="Tools"
      >
        <p className="workspace-hint workspace-tools-section-hint">
          Send intents to extra-functional partners via TMF921. Intents are loaded from the selected
          knowledge graph target.
        </p>
        <ul className="workspace-tools-list">
          {EXTRA_FUNCTIONAL_TOOLS.map((tool) => {
          const tmfUrl = resolveTmfUrl(tool.id);
          const sendTitle = kgDisabledTitle ?? `Send intent to ${tool.label}`;

          const handleSendClick = () => {
            if (kgActionsDisabled) {
              return;
            }
            if (!tmfUrl) {
              setSendUrlError({ toolId: tool.id, toolLabel: tool.label });
              return;
            }
            setActiveDialog({ kind: "send", toolId: tool.id });
          };

          return (
            <li key={tool.id} className="workspace-tools-row">
              <span className="workspace-tools-row-label">{tool.label}</span>
              <div className="workspace-tools-row-actions">
                <button
                  aria-label={`Settings for ${tool.label}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action workspace-tools-action"
                  onClick={() => setActiveDialog({ kind: "settings", toolId: tool.id })}
                  title={`TMF921 URL${tmfUrl ? `: ${tmfUrl}` : " (not set)"}`}
                  type="button"
                >
                  <ToolConfigureIcon />
                </button>
                <button
                  aria-label={`Test send to ${tool.label}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action workspace-tools-action"
                  disabled={kgActionsDisabled}
                  onClick={() => setActiveDialog({ kind: "test-send", toolId: tool.id })}
                  title={kgDisabledTitle ?? `Test send to ${tool.label} (preview turtle only)`}
                  type="button"
                >
                  <ToolTestSendIcon />
                </button>
                <button
                  aria-label={`Send intent to ${tool.label}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action workspace-tools-action"
                  disabled={kgActionsDisabled}
                  onClick={handleSendClick}
                  title={sendTitle}
                  type="button"
                >
                  <ToolSendIcon />
                </button>
              </div>
            </li>
          );
          })}
        </ul>
      </WorkspaceCollapsibleSection>

      {sendUrlError ? (
        <div
          className="workspace-save-name-dialog-backdrop"
          onClick={() => setSendUrlError(null)}
          role="presentation"
        >
          <div
            aria-labelledby="workspace-tool-send-url-error-title"
            aria-modal="true"
            className="workspace-save-name-dialog"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <h3 id="workspace-tool-send-url-error-title">TMF921 URL not configured</h3>
            <p className="workspace-save-name-dialog-error" role="alert">
              No TMF921 base URL is set for <strong>{sendUrlError.toolLabel}</strong>. Open Settings
              (gear icon) for this tool and enter the API base, for example{" "}
              <code>http://host:3021/tmf-api/intentManagement/v5</code> (without <code>/intent</code>
              ).
            </p>
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button workspace-button-secondary"
                onClick={() => setSendUrlError(null)}
                type="button"
              >
                Close
              </button>
              <button
                className="workspace-button"
                onClick={() => {
                  setSendUrlError(null);
                  setActiveDialog({ kind: "settings", toolId: sendUrlError.toolId });
                }}
                type="button"
              >
                Open settings
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeDialog?.kind === "settings" && activeTool ? (
        <ExtraFunctionalToolSettingsDialog
          envDefaultUrl={envDefaults[activeTool.id]}
          onClose={() => setActiveDialog(null)}
          onSave={(url) => handleSaveUrl(activeTool.id, url)}
          open
          storedUrl={urlPrefs[activeTool.id] ?? ""}
          toolId={activeTool.id}
          toolLabel={activeTool.label}
        />
      ) : null}

      {activeDialog?.kind === "send" &&
      activeTool &&
      selectedTarget &&
      !kgActionsDisabled ? (
        <SendIntentToToolDialog
          graphDbBaseUrl={graphDbBaseUrl}
          kgTargetDisplayName={selectedTarget.displayName}
          kgTargetId={selectedKgTargetId}
          onClose={() => setActiveDialog(null)}
          open
          tmfBaseUrl={resolveTmfUrl(activeTool.id)}
          toolId={activeTool.id}
          toolLabel={activeTool.label}
        />
      ) : null}

      {activeDialog?.kind === "test-send" &&
      activeTool &&
      selectedTarget &&
      !kgActionsDisabled ? (
        <TestSendIntentToToolDialog
          graphDbBaseUrl={graphDbBaseUrl}
          kgTargetDisplayName={selectedTarget.displayName}
          kgTargetId={selectedKgTargetId}
          onClose={() => setActiveDialog(null)}
          open
          toolId={activeTool.id}
          toolLabel={activeTool.label}
        />
      ) : null}
    </>
  );
}
