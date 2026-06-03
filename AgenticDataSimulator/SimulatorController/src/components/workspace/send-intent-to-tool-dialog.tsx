"use client";

import { useCallback, useState } from "react";

import {
  ToolIntentPickerDialog,
  type KgTargetIntentOption,
} from "@/components/workspace/tool-intent-picker-dialog";
import type { ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";
import { withAppBasePath } from "@/lib/app-paths";

export type SendIntentToToolDialogProps = {
  open: boolean;
  toolId: ExtraFunctionalToolId;
  toolLabel: string;
  tmfBaseUrl: string;
  kgTargetId: string;
  kgTargetDisplayName: string;
  graphDbBaseUrl: string;
  onClose: () => void;
};

function formatResponseBody(body: unknown): string {
  if (body === null || body === undefined) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

export function SendIntentToToolDialog({
  open,
  toolId,
  toolLabel,
  tmfBaseUrl,
  kgTargetId,
  kgTargetDisplayName,
  graphDbBaseUrl,
  onClose,
}: SendIntentToToolDialogProps) {
  const [sending, setSending] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  const handleSend = useCallback(
    async (selectedIntent: KgTargetIntentOption | null) => {
      if (!selectedIntent || sending) {
        return;
      }
      setSending(true);
      setResultMessage(null);
      setResultError(null);
      try {
        const response = await fetch(withAppBasePath("/api/tools/send-intent"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolId,
            tmfBaseUrl,
            kgTargetId,
            intentId: selectedIntent.intentId,
            graphDbBaseUrl: graphDbBaseUrl.trim() || undefined,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          status?: number;
          targetUrl?: string;
          body?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : `Send failed (${response.status}).`,
          );
        }
        const status = typeof body.status === "number" ? body.status : response.status;
        const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl : "";
        const snippet = formatResponseBody(body.body);
        setResultMessage(
          `Sent to ${targetUrl || toolLabel}. HTTP ${status}.${snippet ? `\n\n${snippet}` : ""}`,
        );
      } catch (err) {
        setResultError(String(err));
      } finally {
        setSending(false);
      }
    },
    [graphDbBaseUrl, kgTargetId, sending, tmfBaseUrl, toolId, toolLabel],
  );

  return (
    <ToolIntentPickerDialog
      graphDbBaseUrl={graphDbBaseUrl}
      hint={`Select an intent to send to ${toolLabel} via TMF921 createIntent.`}
      kgTargetDisplayName={kgTargetDisplayName}
      kgTargetId={kgTargetId}
      onClose={onClose}
      open={open}
      title={`Send intent to ${toolLabel}`}
    >
      {({ selectedIntent, loading, error }) => (
        <>
          {!tmfBaseUrl.trim() ? (
            <p className="workspace-save-name-dialog-error" role="alert">
              Configure a TMF921 base URL in Settings before sending.
            </p>
          ) : null}
          {resultError ? (
            <p className="workspace-save-name-dialog-error" role="alert">
              {resultError}
            </p>
          ) : null}
          {resultMessage ? (
            <pre className="workspace-tool-response-snippet">{resultMessage}</pre>
          ) : null}
          <div className="workspace-save-name-dialog-actions">
            <button
              className="workspace-button"
              disabled={
                sending ||
                loading ||
                Boolean(error) ||
                !selectedIntent ||
                !tmfBaseUrl.trim()
              }
              onClick={() => void handleSend(selectedIntent)}
              type="button"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </>
      )}
    </ToolIntentPickerDialog>
  );
}
