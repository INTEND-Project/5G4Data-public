"use client";

import { useCallback, useEffect, useState } from "react";

import type { ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";
import { parseTmfBaseUrlInput } from "@/lib/tools/parse-tmf-base-url";

export type ExtraFunctionalToolSettingsDialogProps = {
  open: boolean;
  toolId: ExtraFunctionalToolId;
  toolLabel: string;
  storedUrl: string;
  envDefaultUrl?: string;
  onSave: (url: string) => void;
  onClose: () => void;
};

export function ExtraFunctionalToolSettingsDialog({
  open,
  toolId,
  toolLabel,
  storedUrl,
  envDefaultUrl,
  onSave,
  onClose,
}: ExtraFunctionalToolSettingsDialogProps) {
  const [draftUrl, setDraftUrl] = useState(storedUrl);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftUrl(storedUrl);
    setValidationError(null);
  }, [open, storedUrl]);

  const handleSave = useCallback(() => {
    const trimmed = draftUrl.trim();
    if (!trimmed.length) {
      onSave("");
      onClose();
      return;
    }
    const parsed = parseTmfBaseUrlInput(trimmed);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }
    setValidationError(null);
    onSave(parsed.url);
    onClose();
  }, [draftUrl, onClose, onSave]);

  const handleReset = useCallback(() => {
    if (envDefaultUrl) {
      setDraftUrl(envDefaultUrl);
      setValidationError(null);
    }
  }, [envDefaultUrl]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="workspace-save-name-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby="workspace-tool-settings-dialog-title"
        aria-modal="true"
        className="workspace-save-name-dialog workspace-tool-settings-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="workspace-tool-settings-dialog-title">{toolLabel} settings</h3>
        <p className="workspace-save-as-dialog-hint">
          TMF921 Intent Management API base URL for <strong>{toolId}</strong> (without{" "}
          <code>/intent</code>). Example:{" "}
          <code>http://host:3021/tmf-api/intentManagement/v5</code>
        </p>

        <label className="workspace-label" htmlFor="workspace-tool-tmf-base-url">
          TMF921 base URL
        </label>
        <input
          className="workspace-input"
          id="workspace-tool-tmf-base-url"
          onChange={(event) => {
            setDraftUrl(event.target.value);
            setValidationError(null);
          }}
          placeholder={envDefaultUrl ?? "https://example.host/tmf-api/intentManagement/v5"}
          type="url"
          value={draftUrl}
        />

        {envDefaultUrl ? (
          <p className="workspace-hint">
            Environment default: <code>{envDefaultUrl}</code>
          </p>
        ) : null}

        {validationError ? (
          <p className="workspace-save-name-dialog-error" role="alert">
            {validationError}
          </p>
        ) : null}

        <div className="workspace-save-name-dialog-actions">
          {envDefaultUrl ? (
            <button
              className="workspace-button workspace-button-secondary"
              onClick={handleReset}
              type="button"
            >
              Use env default
            </button>
          ) : null}
          <button
            className="workspace-button workspace-button-secondary"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button className="workspace-button" onClick={handleSave} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
