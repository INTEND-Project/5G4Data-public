"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentLlmPreferences } from "@/components/workspace/agent-llm-preferences-context";
import {
  getCachedModelsForBaseUrl,
  resolveAgentModelsFetchBaseUrl,
  setCachedModelsForBaseUrl,
} from "@/lib/agents/agent-llm-models-cache";
import {
  DEFAULT_AGENT_TEMPERATURE,
  DEFAULT_LLM_API_BASE_URL_SUGGESTIONS,
  DEFAULT_REPORTING_INTERVAL_MINUTES,
  isIntentGenerationAgent,
  llmApiBaseUrlSuggestions,
  normalizeAgentLlmPreference,
  normalizeLlmApiBaseUrl,
} from "@/lib/agents/agent-llm-preferences";

export type AgentRuntimeLlmDefaults = {
  model: string;
  apiBaseUrl?: string;
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

const CUSTOM_API_BASE_URL_OPTION = "__custom_api_base_url__";
const CUSTOM_MODEL_OPTION = "__custom_model__";

function formatDefaultModelLabel(runtime: AgentRuntimeLlmDefaults | null, loading: boolean): string {
  if (loading) return "Loading environment default…";
  if (!runtime?.model) return "Environment default (unavailable)";
  const source =
    runtime.source === "agent" ? "agent" : runtime.source === "env" ? ".env" : "environment";
  return `Environment default: ${runtime.model} (${source})`;
}

function apiBaseUrlSelectValue(apiBaseUrl: string, presetUrls: string[]): string {
  const normalized = normalizeLlmApiBaseUrl(apiBaseUrl);
  if (!normalized) return "";
  if (presetUrls.includes(normalized)) return normalized;
  return CUSTOM_API_BASE_URL_OPTION;
}

function modelSelectValue(model: string, models: string[], customModelMode: boolean): string {
  if (customModelMode) return CUSTOM_MODEL_OPTION;
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (models.includes(trimmed)) return trimmed;
  return trimmed;
}

async function fetchModelsForBaseUrl(
  openAiModelsApiUrl: string,
  baseUrl: string,
): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("baseUrl", baseUrl);
  const response = await fetch(`${openAiModelsApiUrl}?${params.toString()}`, {
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
  return Array.isArray(body.models) ? body.models : [];
}

export function AgentSettingsDialog({
  open,
  agentName,
  openAiModelsApiUrl,
  agentRuntimeLlmApiUrl,
  onClose,
}: AgentSettingsDialogProps) {
  const { preference, hasStored, setPreference } = useAgentLlmPreferences(agentName);
  const showReportingInterval = isIntentGenerationAgent(agentName);
  const [model, setModel] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [customApiUrlDraft, setCustomApiUrlDraft] = useState("");
  const [customModelDraft, setCustomModelDraft] = useState("");
  const [customModelMode, setCustomModelMode] = useState(false);
  const [temperature, setTemperature] = useState(DEFAULT_AGENT_TEMPERATURE);
  const [reportingIntervalMinutes, setReportingIntervalMinutes] = useState(
    DEFAULT_REPORTING_INTERVAL_MINUTES,
  );
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

  const apiBaseUrlPresetOptions = useMemo(
    () => llmApiBaseUrlSuggestions(runtimeDefaults?.apiBaseUrl),
    [runtimeDefaults?.apiBaseUrl],
  );

  const modelsFetchBaseUrl = useMemo(
    () =>
      resolveAgentModelsFetchBaseUrl(
        apiBaseUrl,
        hasStored ? preference.apiBaseUrl : "",
        runtimeDefaults?.apiBaseUrl ?? "",
      ),
    [apiBaseUrl, hasStored, preference.apiBaseUrl, runtimeDefaults?.apiBaseUrl],
  );

  const showCustomApiUrlInput =
    apiBaseUrlSelectValue(apiBaseUrl, apiBaseUrlPresetOptions) === CUSTOM_API_BASE_URL_OPTION;

  const showCustomModelInput = customModelMode;

  const applyApiBaseUrl = useCallback(
    (next: string) => {
      const normalized = normalizeLlmApiBaseUrl(next);
      setApiBaseUrl(normalized);
      setCustomApiUrlDraft(normalized);
      const fetchBaseUrl = resolveAgentModelsFetchBaseUrl(
        normalized,
        hasStored ? preference.apiBaseUrl : "",
        runtimeDefaults?.apiBaseUrl ?? "",
      );
      const cached = getCachedModelsForBaseUrl(fetchBaseUrl);
      if (cached) {
        setModels(cached);
      }
    },
    [hasStored, preference.apiBaseUrl, runtimeDefaults?.apiBaseUrl],
  );

  const loadModelsForBaseUrl = useCallback(
    async (baseUrl: string, cancelled: () => boolean) => {
      setLoadingModels(true);
      try {
        const cached = getCachedModelsForBaseUrl(baseUrl);
        if (cached) {
          setModels(cached);
        }

        const nextModels = await fetchModelsForBaseUrl(openAiModelsApiUrl, baseUrl);
        if (cancelled()) return;

        setModels(nextModels);
        setError(null);
        if (nextModels.length > 0) {
          setCachedModelsForBaseUrl(baseUrl, nextModels);
        }
      } catch (err) {
        if (cancelled()) return;
        const stillCached = getCachedModelsForBaseUrl(baseUrl);
        if (stillCached) {
          setModels(stillCached);
          setError(null);
        } else {
          setError(String(err));
        }
      } finally {
        if (!cancelled()) {
          setLoadingModels(false);
        }
      }
    },
    [openAiModelsApiUrl],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(false);
    if (hasStored) {
      setModel(preference.model);
      setApiBaseUrl(preference.apiBaseUrl);
      setCustomApiUrlDraft(preference.apiBaseUrl);
      setCustomModelDraft(preference.model);
      setCustomModelMode(false);
      setTemperature(preference.temperature);
      setReportingIntervalMinutes(
        preference.reportingIntervalMinutes ?? DEFAULT_REPORTING_INTERVAL_MINUTES,
      );
      return;
    }
    setModel("");
    setApiBaseUrl("");
    setCustomApiUrlDraft("");
    setCustomModelDraft("");
    setCustomModelMode(false);
    setTemperature(runtimeDefaults?.temperature ?? DEFAULT_AGENT_TEMPERATURE);
    setReportingIntervalMinutes(DEFAULT_REPORTING_INTERVAL_MINUTES);
  }, [
    open,
    hasStored,
    preference.model,
    preference.apiBaseUrl,
    preference.temperature,
    preference.reportingIntervalMinutes,
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
            apiBaseUrl: typeof body.apiBaseUrl === "string" ? body.apiBaseUrl : undefined,
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
    void loadModelsForBaseUrl(modelsFetchBaseUrl, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, loadModelsForBaseUrl, modelsFetchBaseUrl]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const prefetchDefaults = async () => {
      await Promise.all(
        DEFAULT_LLM_API_BASE_URL_SUGGESTIONS.map(async (baseUrl) => {
          if (getCachedModelsForBaseUrl(baseUrl)) return;
          try {
            const nextModels = await fetchModelsForBaseUrl(openAiModelsApiUrl, baseUrl);
            if (cancelled) return;
            if (nextModels.length > 0) {
              setCachedModelsForBaseUrl(baseUrl, nextModels);
            }
          } catch {
            // Best-effort warm-up for preset endpoints.
          }
        }),
      );
    };

    void prefetchDefaults();
    return () => {
      cancelled = true;
    };
  }, [open, openAiModelsApiUrl]);

  const handleApiBaseUrlSelect = useCallback(
    (value: string) => {
      if (value === CUSTOM_API_BASE_URL_OPTION) {
        setCustomApiUrlDraft(apiBaseUrl);
        return;
      }
      applyApiBaseUrl(value);
    },
    [apiBaseUrl, applyApiBaseUrl],
  );

  const handleCustomApiUrlCommit = useCallback(() => {
    applyApiBaseUrl(customApiUrlDraft);
  }, [applyApiBaseUrl, customApiUrlDraft]);

  const handleModelSelect = useCallback(
    (value: string) => {
      if (value === CUSTOM_MODEL_OPTION) {
        setCustomModelMode(true);
        setCustomModelDraft(model);
        return;
      }
      setCustomModelMode(false);
      setModel(value);
      setCustomModelDraft(value);
    },
    [model],
  );

  const handleCustomModelCommit = useCallback(() => {
    const trimmed = customModelDraft.trim();
    setModel(trimmed);
    setCustomModelMode(false);
  }, [customModelDraft]);

  const handleSave = useCallback(() => {
    setPreference(
      normalizeAgentLlmPreference({
        model,
        apiBaseUrl,
        temperature: Number.parseFloat(String(temperature)),
        ...(showReportingInterval
          ? {
              reportingIntervalMinutes: Number.parseInt(
                String(reportingIntervalMinutes),
                10,
              ),
            }
          : {}),
      }),
    );
    setSaved(true);
    onClose();
  }, [
    apiBaseUrl,
    model,
    onClose,
    reportingIntervalMinutes,
    setPreference,
    showReportingInterval,
    temperature,
  ]);

  if (!open) {
    return null;
  }

  const selectedApiBaseUrl = apiBaseUrlSelectValue(apiBaseUrl, apiBaseUrlPresetOptions);
  const selectedModel = modelSelectValue(model, models, customModelMode);

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
          metadata. Leave model or API URL empty to use the agent&apos;s environment default
          (OpenAI, Ollama, Open WebUI, etc.).
        </p>

        <label className="workspace-label" htmlFor="workspace-agent-settings-api-base-url">
          API base URL
        </label>
        <select
          className="workspace-select"
          disabled={loadingRuntime}
          id="workspace-agent-settings-api-base-url"
          onChange={(event) => handleApiBaseUrlSelect(event.target.value)}
          value={selectedApiBaseUrl}
        >
          <option value="">Use environment default</option>
          {apiBaseUrlPresetOptions.map((url) => (
            <option key={url} value={url}>
              {url}
            </option>
          ))}
          <option value={CUSTOM_API_BASE_URL_OPTION}>Custom URL…</option>
        </select>
        {showCustomApiUrlInput ? (
          <input
            className="workspace-input"
            onBlur={handleCustomApiUrlCommit}
            onChange={(event) => setCustomApiUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleCustomApiUrlCommit();
              }
            }}
            placeholder="https://host:port/v1"
            spellCheck={false}
            type="url"
            value={customApiUrlDraft}
          />
        ) : null}
        <p className="workspace-hint">
          OpenAI-compatible endpoint base, including <code>/v1</code> when required (Ollama) or
          <code>/api</code> for Open WebUI.
        </p>

        <label className="workspace-label" htmlFor="workspace-agent-settings-model">
          Model
        </label>
        <select
          className="workspace-select"
          disabled={loadingRuntime}
          id="workspace-agent-settings-model"
          onChange={(event) => handleModelSelect(event.target.value)}
          value={selectedModel}
        >
          <option value="">
            {loadingModels && models.length === 0
              ? "Loading models…"
              : defaultModelOptionLabel}
          </option>
          {models.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          {model.trim() && !models.includes(model.trim()) ? (
            <option value={model.trim()}>{model.trim()}</option>
          ) : null}
          <option value={CUSTOM_MODEL_OPTION}>Custom model…</option>
        </select>
        {showCustomModelInput ? (
          <input
            className="workspace-input"
            disabled={loadingModels}
            onBlur={handleCustomModelCommit}
            onChange={(event) => setCustomModelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleCustomModelCommit();
              }
            }}
            placeholder="Model name"
            spellCheck={false}
            type="text"
            value={customModelDraft}
          />
        ) : null}
        {loadingModels && models.length > 0 ? (
          <p className="workspace-hint">Refreshing model list…</p>
        ) : null}

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

        {showReportingInterval ? (
          <>
            <label
              className="workspace-label"
              htmlFor="workspace-agent-settings-reporting-interval"
            >
              Reporting interval (minutes)
            </label>
            <input
              className="workspace-input"
              id="workspace-agent-settings-reporting-interval"
              max={1440}
              min={1}
              onChange={(event) =>
                setReportingIntervalMinutes(Number.parseInt(event.target.value, 10))
              }
              step={1}
              type="number"
              value={reportingIntervalMinutes}
            />
            <p className="workspace-hint">
              Default is {DEFAULT_REPORTING_INTERVAL_MINUTES} minutes. Used for observation
              report triggers in generated intents (per-expectation event URIs).
            </p>
          </>
        ) : null}

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
