"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { withAppBasePath } from "@/lib/app-paths";

export type KgTargetIntentOption = {
  intentId: string;
  description: string | null;
};

export type ToolIntentPickerDialogProps = {
  open: boolean;
  title: string;
  hint: string;
  kgTargetId: string;
  kgTargetDisplayName: string;
  graphDbBaseUrl: string;
  onClose: () => void;
  /** Extra class names on the dialog panel (e.g. larger test-send layout). */
  dialogClassName?: string;
  children?: (ctx: {
    selectedIntent: KgTargetIntentOption | null;
    loading: boolean;
    error: string | null;
    intents: KgTargetIntentOption[];
    filter: string;
    setFilter: (value: string) => void;
  }) => ReactNode;
};

export function ToolIntentPickerDialog({
  open,
  title,
  hint,
  kgTargetId,
  kgTargetDisplayName,
  graphDbBaseUrl,
  onClose,
  dialogClassName,
  children,
}: ToolIntentPickerDialogProps) {
  const [intents, setIntents] = useState<KgTargetIntentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedIntentId, setSelectedIntentId] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setFilter("");
    setSelectedIntentId("");
    setError(null);
  }, [open, kgTargetId]);

  useEffect(() => {
    if (!open || !kgTargetId.trim()) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (graphDbBaseUrl.trim()) {
          params.set("graphDbBaseUrl", graphDbBaseUrl.trim());
        }
        const query = params.toString();
        const url = withAppBasePath(
          `/api/kg-targets/${encodeURIComponent(kgTargetId)}/intents${query ? `?${query}` : ""}`,
        );
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
        const body = (await response.json().catch(() => ({}))) as {
          intents?: KgTargetIntentOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : `Failed to load intents (${response.status}).`,
          );
        }
        if (!cancelled) {
          const next = Array.isArray(body.intents) ? body.intents : [];
          setIntents(next);
          if (next.length > 0) {
            setSelectedIntentId(next[0]!.intentId);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setIntents([]);
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, kgTargetId, graphDbBaseUrl]);

  const filteredIntents = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return intents;
    }
    return intents.filter((entry) => {
      const haystack = `${entry.intentId} ${entry.description ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [filter, intents]);

  const selectedIntent = useMemo(
    () => intents.find((entry) => entry.intentId === selectedIntentId) ?? null,
    [intents, selectedIntentId],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="workspace-save-name-dialog-backdrop"
      onClick={handleClose}
      role="presentation"
    >
      <div
        aria-labelledby="workspace-tool-intent-picker-title"
        aria-modal="true"
        className={`workspace-save-name-dialog workspace-tool-intent-picker-dialog${dialogClassName ? ` ${dialogClassName}` : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="workspace-tool-intent-picker-title">{title}</h3>
        <p className="workspace-save-as-dialog-hint">{hint}</p>
        <p className="workspace-hint">
          Knowledge graph target: <strong>{kgTargetDisplayName}</strong>
        </p>

        <label className="workspace-label" htmlFor="workspace-tool-intent-filter">
          Filter intents
        </label>
        <input
          className="workspace-input"
          id="workspace-tool-intent-filter"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Intent id or description"
          type="search"
          value={filter}
        />

        <label className="workspace-label" htmlFor="workspace-tool-intent-select">
          Intent
        </label>
        {loading ? (
          <p className="workspace-hint">Loading intents from GraphDB…</p>
        ) : filteredIntents.length === 0 ? (
          <p className="workspace-hint">
            {intents.length === 0
              ? "No intents found in this knowledge graph."
              : "No intents match the filter."}
          </p>
        ) : (
          <select
            className="workspace-input"
            id="workspace-tool-intent-select"
            onChange={(event) => setSelectedIntentId(event.target.value)}
            size={Math.min(8, Math.max(3, filteredIntents.length))}
            value={selectedIntentId}
          >
            {filteredIntents.map((entry) => (
              <option key={entry.intentId} value={entry.intentId}>
                {entry.description
                  ? `${entry.intentId} — ${entry.description}`
                  : entry.intentId}
              </option>
            ))}
          </select>
        )}

        {error ? (
          <p className="workspace-save-name-dialog-error" role="alert">
            {error}
          </p>
        ) : null}

        {children?.({
          selectedIntent,
          loading,
          error,
          intents,
          filter,
          setFilter,
        })}

        <div className="workspace-save-name-dialog-actions">
          <button
            className="workspace-button workspace-button-secondary"
            onClick={handleClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
