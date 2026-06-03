"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentLlmPreferences } from "@/components/workspace/agent-llm-preferences-context";
import {
  DEFAULT_AGENT_TEMPERATURE,
  normalizeAgentLlmPreference,
} from "@/lib/agents/agent-llm-preferences";

export type AgentRuntimeLlmDefaults = {
  model: string;
  temperature: number;
  source?: "agent" | "env";
};

export type AgentSettingsDialogProps = {
  open: boolean;
  agentName: string;
  openAiModelsApiUrl: string;
  agentRuntimeLlmApiUrl: string;
  onClose: () => void;
};

function formatDefaultModelLabel(runtime: AgentRuntimeLlmDefaults | null, loading: boolean): string {
  if (loading) return "Loading environment default…";
  if (!runtime?.model) return "Environment default (unavailable)";
  const source =
    runtime.source === "agent" ? "agent" : runtime.source === "env" ? ".env" : "environment";
  return `Environment default: ${runtime.model} (${source})`;
}

export function AgentSettingsDialog({
  open,
  agentName,
  openAiModelsApiUrl,
  agentRuntimeLlmApiUrl,
  onClose,
}: AgentSettingsDialogProps) {
  const { preference, hasStored, setPreference } = useAgentLlmPreferences(agentName);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(DEFAULT_AGENT_TEMPERATURE);
  const [models, setModels] = useState<string[]>([]);
  const [runtimeDefaults, setRuntimeDefaults] = useState<AgentRuntimeLlmDefaults | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const defaultModelOptionLabel = useMemo(
    () => formatDefaultModelLabel(runtimeDefaults, loadingRuntime),
    [loadingRuntime, runtimeDefaults],
  );

  const runtimeTemperature = runtimeDefaults?.temperature ?? DEFAULT_AGENT_TEMPERATURE;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(false);
    if (hasStored) {
      setModel(preference.model);
      setTemperature(preference.temperature);
      return;
    }
    setModel("");
    setTemperature(runtimeDefaults?.temperature ?? DEFAULT_AGENT_TEMPERATURE);
  }, [
    open,
    hasStored,
    preference.model,
    preference.temperature,
    runtimeDefaults?.temperature,
  ]);

  useEffect(() => {
    if (!open || !agentRuntimeLlmApiUrl) return;

    let cancelled = false;
    const load = async () => {
      setLoadingRuntime(true);
      try {
        const response = await fetch(agentRuntimeLlmApiUrl, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as AgentRuntimeLlmDefaults & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : `Failed to load agent defaults (${response.status}).`,
          );
        }
        if (!cancelled && typeof body.model === "string") {
          setRuntimeDefaults({
            model: body.model,
            temperature:
              typeof body.temperature === "number" ? body.temperature : DEFAULT_AGENT_TEMPERATURE,
            source: body.source,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setRuntimeDefaults(null);
          setError((current) => current ?? String(err));
        }
      } finally {
        if (!cancelled) {
          setLoadingRuntime(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, agentRuntimeLlmApiUrl]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const load = async () => {
      setLoadingModels(true);
      try {
        const response = await fetch(openAiModelsApiUrl, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as {
          models?: string[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            typeof body.error === "string" ? body.error : `Failed to load models (${response.status}).`,
          );
        }
        if (!cancelled) {
          setModels(Array.isArray(body.models) ? body.models : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, openAiModelsApiUrl]);

  const handleSave = useCallback(() => {
    setPreference(
      normalizeAgentLlmPreference({
        model,
        temperature: Number.parseFloat(String(temperature)),
      }),
    );
    setSaved(true);
    onClose();
  }, [model, onClose, setPreference, temperature]);

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
        aria-labelledby="workspace-agent-settings-dialog-title"
        aria-modal="true"
        className="workspace-save-name-dialog workspace-agent-settings-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="workspace-agent-settings-dialog-title">Agent LLM settings</h3>
        <p className="workspace-save-as-dialog-hint">
          Settings for <strong>{agentName}</strong> are sent on the next A2A messages via
          metadata. Choose the first model option to use the agent&apos;s current environment
          default.
        </p>

        <label className="workspace-label" htmlFor="workspace-agent-settings-model">
          Model
        </label>
        <select
          className="workspace-input"
          disabled={loadingModels || loadingRuntime}
          id="workspace-agent-settings-model"
          onChange={(event) => setModel(event.target.value)}
          value={model}
        >
          <option value="">{defaultModelOptionLabel}</option>
          {model && !models.includes(model) ? <option value={model}>{model}</option> : null}
          {models.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <label className="workspace-label" htmlFor="workspace-agent-settings-temperature">
          Temperature
        </label>
        <input
          className="workspace-input"
          id="workspace-agent-settings-temperature"
          max={2}
          min={0}
          onChange={(event) => setTemperature(Number.parseFloat(event.target.value))}
          step={0.1}
          type="number"
          value={temperature}
        />
        <p className="workspace-hint">
          {loadingRuntime
            ? "Loading agent environment default…"
            : hasStored
              ? `Agent environment default: ${runtimeTemperature}`
              : `Using agent environment default: ${runtimeTemperature}`}
        </p>

        {error ? (
          <p className="workspace-save-name-dialog-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="workspace-hint">Settings saved for this browser.</p>
        ) : null}

        <div className="workspace-save-name-dialog-actions">
          <button className="workspace-button workspace-button-secondary" onClick={onClose} type="button">
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
