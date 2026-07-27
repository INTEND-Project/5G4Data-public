"use client";

import { useCallback, useState } from "react";

import {
  ToolIntentPickerDialog,
  type KgTargetIntentOption,
} from "@/components/workspace/tool-intent-picker-dialog";
import type { ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";
import { withAppBasePath } from "@/lib/app-paths";

export type TestSendIntentToToolDialogProps = {
  open: boolean;
  toolId: ExtraFunctionalToolId;
  toolLabel: string;
  kgTargetId: string;
  kgTargetDisplayName: string;
  graphDbBaseUrl: string;
  onClose: () => void;
};

export function TestSendIntentToToolDialog({
  open,
  toolId,
  toolLabel,
  kgTargetId,
  kgTargetDisplayName,
  graphDbBaseUrl,
  onClose,
}: TestSendIntentToToolDialogProps) {
  const [previewing, setPreviewing] = useState(false);
  const [turtle, setTurtle] = useState<string | null>(null);
  const [showFullPayload, setShowFullPayload] = useState(false);
  const [fullPayload, setFullPayload] = useState<unknown>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreview = useCallback(
    async (selectedIntent: KgTargetIntentOption | null) => {
      if (!selectedIntent || previewing) {
        return;
      }
      setPreviewing(true);
      setPreviewError(null);
      setTurtle(null);
      setFullPayload(null);
      try {
        const response = await fetch(withAppBasePath("/api/tools/preview-intent"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolId,
            kgTargetId,
            intentId: selectedIntent.intentId,
            graphDbBaseUrl: graphDbBaseUrl.trim() || undefined,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          turtle?: string;
          payload?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : `Preview failed (${response.status}).`,
          );
        }
        setTurtle(typeof body.turtle === "string" ? body.turtle : "");
        setFullPayload(body.payload ?? null);
      } catch (err) {
        setPreviewError(String(err));
      } finally {
        setPreviewing(false);
      }
    },
    [graphDbBaseUrl, kgTargetId, previewing, toolId],
  );

  return (
    <ToolIntentPickerDialog
      dialogClassName="workspace-tool-test-send-dialog"
      graphDbBaseUrl={graphDbBaseUrl}
      hint={`Preview the Turtle that would be sent to ${toolLabel}. imo:handler is rewritten to "${toolId}". No HTTP request is made to the tool.`}
      kgTargetDisplayName={kgTargetDisplayName}
      kgTargetId={kgTargetId}
      onClose={onClose}
      open={open}
      title={`Test send to ${toolLabel}`}
    >
      {({ selectedIntent, loading, error }) => (
        <>
          {previewError ? (
            <p className="workspace-save-name-dialog-error" role="alert">
              {previewError}
            </p>
          ) : null}
          {turtle !== null ? (
            <>
              <p className="workspace-hint">Outbound Turtle (not sent):</p>
              <pre className="workspace-tool-turtle-preview">{turtle}</pre>
              <label className="workspace-tools-payload-toggle">
                <input
                  checked={showFullPayload}
                  onChange={(event) => setShowFullPayload(event.target.checked)}
                  type="checkbox"
                />
                Show full TMF921 JSON payload
              </label>
              {showFullPayload && fullPayload !== null ? (
                <pre className="workspace-tool-response-snippet">
                  {JSON.stringify(fullPayload, null, 2)}
                </pre>
              ) : null}
            </>
          ) : null}
          <div className="workspace-save-name-dialog-actions">
            <button
              className="workspace-button"
              disabled={previewing || loading || Boolean(error) || !selectedIntent}
              onClick={() => void handlePreview(selectedIntent)}
              type="button"
            >
              {previewing ? "Loading…" : "Show turtle"}
            </button>
          </div>
        </>
      )}
    </ToolIntentPickerDialog>
  );
}
