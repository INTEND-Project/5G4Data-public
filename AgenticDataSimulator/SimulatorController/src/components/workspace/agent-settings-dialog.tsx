"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentLlmPreferences } from "@/components/workspace/agent-llm-preferences-context";
import {
  getCachedModelsForBaseUrl,
  resolveAgentModelsFetchBaseUrl,
  setCachedModelsForBaseUrl,
} from "@/lib/agents/agent-llm-models-cache";
import {
  ANTHROPIC_MODEL_SUGGESTIONS,
  DEFAULT_AGENT_TEMPERATURE,
  DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY,
  DEFAULT_INTENT_STATUS_REPORTS_ENABLED,
  DEFAULT_LLM_API_BASE_URL_SUGGESTIONS,
  DEFAULT_OBSERVATION_RETENTION_WINDOW,
  DEFAULT_REPORTING_INTERVAL_MINUTES,
  STOP_SEQUENCES_HELP_TEXT,
  clampNumCtx,
  isIntentGenerationAgent,
  isObservationAgent,
  llmApiBaseUrlSuggestions,
  normalizeAgentLlmPreference,
  normalizeLlmApiBaseUrl,
  normalizeLlmProvider,
  normalizeStopSequences,
  type AgentLlmProvider,
} from "@/lib/agents/agent-llm-preferences";
import type { FewShotMessage } from "@/lib/agents/modelfile-system-prompt";
import { normalizeModelfileOrSystemPrompt } from "@/lib/agents/modelfile-system-prompt";

export type AgentRuntimeLlmDefaults = {
  model: string;
  apiBaseUrl?: string;
  temperature: number;
  llmProvider?: AgentLlmProvider;
  systemPrompt?: string;
  numCtx?: number;
  stopSequences?: string[];
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
  if (loading) return "Loading agent default…";
  if (!runtime?.model) return "Agent default (unavailable)";
  const source =
    runtime.source === "agent" ? "live agent" : runtime.source === "env" ? ".env fallback" : "default";
  return `Agent default: ${runtime.model} (${source})`;
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

function stopSequencesToText(stops: string[] | undefined): string {
  return stops?.length ? stops.join("\n") : "";
}

function parseStopSequencesText(text: string): string[] | undefined {
  return normalizeStopSequences(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
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
  const { preference, hasStored, setPreference, clearPreference } = useAgentLlmPreferences(agentName);
  const showReportingInterval = isIntentGenerationAgent(agentName);
  const showObservationStatusSettings = isObservationAgent(agentName);
  const [provider, setProvider] = useState<AgentLlmProvider>("openai");
  const [model, setModel] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [customApiUrlDraft, setCustomApiUrlDraft] = useState("");
  const [customModelDraft, setCustomModelDraft] = useState("");
  const [customModelMode, setCustomModelMode] = useState(false);
  const [temperature, setTemperature] = useState(DEFAULT_AGENT_TEMPERATURE);
  const [reportingIntervalMinutes, setReportingIntervalMinutes] = useState(
    DEFAULT_REPORTING_INTERVAL_MINUTES,
  );
  const [observationRetentionWindow, setObservationRetentionWindow] = useState(
    DEFAULT_OBSERVATION_RETENTION_WINDOW,
  );
  const [intentStatusReportsEnabled, setIntentStatusReportsEnabled] = useState(
    DEFAULT_INTENT_STATUS_REPORTS_ENABLED,
  );
  const [intentStatusBootstrapCompliantDelay, setIntentStatusBootstrapCompliantDelay] =
    useState(DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY);
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const [systemPromptCustomized, setSystemPromptCustomized] = useState(false);
  const [fewShotMessages, setFewShotMessages] = useState<FewShotMessage[]>([]);
  const [numCtxDraft, setNumCtxDraft] = useState("");
  const [stopSequencesText, setStopSequencesText] = useState("");
  const [stopHelpOpen, setStopHelpOpen] = useState(false);
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
  const runtimeSystemPrompt = runtimeDefaults?.systemPrompt ?? "";
  const runtimeProvider = runtimeDefaults?.llmProvider ?? "openai";
  const isAnthropic = provider === "anthropic";

  const apiBaseUrlPresetOptions = useMemo(
    () => llmApiBaseUrlSuggestions(runtimeDefaults?.apiBaseUrl, provider),
    [provider, runtimeDefaults?.apiBaseUrl],
  );

  const anthropicModelOptions = useMemo(() => {
    const options: string[] = [...ANTHROPIC_MODEL_SUGGESTIONS];
    const runtimeModel = runtimeDefaults?.model?.trim();
    if (runtimeModel && !options.includes(runtimeModel)) {
      options.unshift(runtimeModel);
    }
    return options;
  }, [runtimeDefaults?.model]);

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

  const listedModels = isAnthropic ? anthropicModelOptions : models;

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
    setStopHelpOpen(false);
    if (hasStored) {
      setProvider(preference.provider ?? runtimeProvider);
      setModel(preference.model);
      setApiBaseUrl(preference.apiBaseUrl);
      setCustomApiUrlDraft(preference.apiBaseUrl);
      setCustomModelDraft(preference.model);
      setCustomModelMode(false);
      setTemperature(preference.temperature);
      setReportingIntervalMinutes(
        preference.reportingIntervalMinutes ?? DEFAULT_REPORTING_INTERVAL_MINUTES,
      );
      setObservationRetentionWindow(
        preference.observationRetentionWindow ?? DEFAULT_OBSERVATION_RETENTION_WINDOW,
      );
      setIntentStatusReportsEnabled(
        preference.intentStatusReportsEnabled ?? DEFAULT_INTENT_STATUS_REPORTS_ENABLED,
      );
      setIntentStatusBootstrapCompliantDelay(
        preference.intentStatusBootstrapCompliantDelay ?? DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY,
      );
      const customized = typeof preference.systemPrompt === "string";
      setSystemPromptCustomized(customized);
      setSystemPromptDraft(
        customized ? preference.systemPrompt! : runtimeDefaults?.systemPrompt ?? "",
      );
      setFewShotMessages(preference.fewShotMessages ?? []);
      setNumCtxDraft(
        typeof preference.numCtx === "number"
          ? String(preference.numCtx)
          : typeof runtimeDefaults?.numCtx === "number"
            ? String(runtimeDefaults.numCtx)
            : "",
      );
      setStopSequencesText(
        stopSequencesToText(
          preference.stopSequences?.length
            ? preference.stopSequences
            : runtimeDefaults?.stopSequences,
        ),
      );
      return;
    }
    setProvider(runtimeProvider);
    setModel("");
    setApiBaseUrl("");
    setCustomApiUrlDraft("");
    setCustomModelDraft("");
    setCustomModelMode(false);
    setTemperature(runtimeDefaults?.temperature ?? DEFAULT_AGENT_TEMPERATURE);
    setReportingIntervalMinutes(DEFAULT_REPORTING_INTERVAL_MINUTES);
    setObservationRetentionWindow(DEFAULT_OBSERVATION_RETENTION_WINDOW);
    setIntentStatusReportsEnabled(DEFAULT_INTENT_STATUS_REPORTS_ENABLED);
    setIntentStatusBootstrapCompliantDelay(DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY);
    setSystemPromptCustomized(false);
    setSystemPromptDraft(runtimeDefaults?.systemPrompt ?? "");
    setFewShotMessages([]);
    setNumCtxDraft(
      typeof runtimeDefaults?.numCtx === "number" ? String(runtimeDefaults.numCtx) : "",
    );
    setStopSequencesText(stopSequencesToText(runtimeDefaults?.stopSequences));
  }, [
    open,
    hasStored,
    preference.model,
    preference.apiBaseUrl,
    preference.provider,
    preference.temperature,
    preference.reportingIntervalMinutes,
    preference.observationRetentionWindow,
    preference.intentStatusReportsEnabled,
    preference.intentStatusBootstrapCompliantDelay,
    preference.systemPrompt,
    preference.fewShotMessages,
    preference.numCtx,
    preference.stopSequences,
    runtimeDefaults?.temperature,
    runtimeDefaults?.systemPrompt,
    runtimeDefaults?.numCtx,
    runtimeDefaults?.stopSequences,
    runtimeProvider,
  ]);

  useEffect(() => {
    if (!open || systemPromptCustomized) return;
    if (runtimeDefaults?.systemPrompt !== undefined) {
      setSystemPromptDraft(runtimeDefaults.systemPrompt);
    }
  }, [open, systemPromptCustomized, runtimeDefaults?.systemPrompt]);

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
            llmProvider: normalizeLlmProvider(body.llmProvider) ?? "openai",
            systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
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
    if (!open || isAnthropic) {
      if (isAnthropic) {
        setLoadingModels(false);
        setModels([]);
      }
      return;
    }

    let cancelled = false;
    void loadModelsForBaseUrl(modelsFetchBaseUrl, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, isAnthropic, loadModelsForBaseUrl, modelsFetchBaseUrl]);

  useEffect(() => {
    if (!open || isAnthropic) return;

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
  }, [open, isAnthropic, openAiModelsApiUrl]);

  const handleProviderChange = useCallback(
    (next: AgentLlmProvider) => {
      setProvider(next);
      setCustomModelMode(false);
      setModel("");
      setCustomModelDraft("");
      setApiBaseUrl("");
      setCustomApiUrlDraft("");
      setNumCtxDraft("");
      if (next === "anthropic") {
        setModels([]);
        setLoadingModels(false);
      }
    },
    [],
  );

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

  const handleRevertSystemPrompt = useCallback(() => {
    setSystemPromptCustomized(false);
    setSystemPromptDraft(runtimeSystemPrompt);
    setFewShotMessages([]);
  }, [runtimeSystemPrompt]);

  const handleResetToAgentDefaults = useCallback(() => {
    clearPreference();
    setProvider(runtimeProvider);
    setModel(runtimeDefaults?.model?.trim() ?? "");
    setApiBaseUrl(runtimeDefaults?.apiBaseUrl?.trim() ?? "");
    setCustomApiUrlDraft(runtimeDefaults?.apiBaseUrl?.trim() ?? "");
    setCustomModelDraft(runtimeDefaults?.model?.trim() ?? "");
    setCustomModelMode(false);
    setTemperature(runtimeDefaults?.temperature ?? DEFAULT_AGENT_TEMPERATURE);
    setReportingIntervalMinutes(DEFAULT_REPORTING_INTERVAL_MINUTES);
    setObservationRetentionWindow(DEFAULT_OBSERVATION_RETENTION_WINDOW);
    setIntentStatusReportsEnabled(DEFAULT_INTENT_STATUS_REPORTS_ENABLED);
    setIntentStatusBootstrapCompliantDelay(DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY);
    setSystemPromptCustomized(false);
    setSystemPromptDraft(runtimeDefaults?.systemPrompt ?? "");
    setFewShotMessages([]);
    setNumCtxDraft(
      typeof runtimeDefaults?.numCtx === "number" ? String(runtimeDefaults.numCtx) : "",
    );
    setStopSequencesText(stopSequencesToText(runtimeDefaults?.stopSequences));
    setSaved(false);
    setError(null);
  }, [
    clearPreference,
    runtimeDefaults?.apiBaseUrl,
    runtimeDefaults?.model,
    runtimeDefaults?.numCtx,
    runtimeDefaults?.stopSequences,
    runtimeDefaults?.systemPrompt,
    runtimeDefaults?.temperature,
    runtimeProvider,
  ]);

  const handleSave = useCallback(() => {
    let nextTemperature = Number.parseFloat(String(temperature));
    let nextNumCtx = numCtxDraft.trim()
      ? clampNumCtx(Number.parseInt(numCtxDraft.trim(), 10))
      : undefined;
    let nextStops = parseStopSequencesText(stopSequencesText);
    let nextSystemPrompt: string | undefined;
    let nextFewShots: FewShotMessage[] | undefined;

    if (systemPromptCustomized) {
      const normalized = normalizeModelfileOrSystemPrompt(systemPromptDraft);
      nextSystemPrompt = normalized.systemPrompt;
      nextFewShots = normalized.fewShotMessages.length > 0 ? normalized.fewShotMessages : undefined;
      if (normalized.isModelfile) {
        setSystemPromptDraft(normalized.systemPrompt);
        setFewShotMessages(normalized.fewShotMessages);
        if (normalized.temperature !== undefined) {
          nextTemperature = normalized.temperature;
          setTemperature(normalized.temperature);
        }
        if (normalized.numCtx !== undefined) {
          nextNumCtx = normalized.numCtx;
          setNumCtxDraft(String(normalized.numCtx));
        }
        if (normalized.stopSequences.length > 0) {
          nextStops = normalized.stopSequences;
          setStopSequencesText(stopSequencesToText(normalized.stopSequences));
        }
      } else {
        setFewShotMessages([]);
      }
    }

    setPreference(
      normalizeAgentLlmPreference({
        model,
        apiBaseUrl,
        provider,
        temperature: nextTemperature,
        ...(showReportingInterval
          ? {
              reportingIntervalMinutes: Number.parseInt(
                String(reportingIntervalMinutes),
                10,
              ),
            }
          : {}),
        ...(showObservationStatusSettings
          ? {
              observationRetentionWindow,
              intentStatusReportsEnabled,
              intentStatusBootstrapCompliantDelay,
            }
          : {}),
        ...(systemPromptCustomized
          ? {
              systemPrompt: nextSystemPrompt ?? "",
              ...(nextFewShots ? { fewShotMessages: nextFewShots } : {}),
            }
          : {}),
        ...(!isAnthropic && nextNumCtx !== undefined ? { numCtx: nextNumCtx } : {}),
        ...(nextStops ? { stopSequences: nextStops } : {}),
      }),
    );
    setSaved(true);
    onClose();
  }, [
    apiBaseUrl,
    isAnthropic,
    model,
    numCtxDraft,
    onClose,
    provider,
    reportingIntervalMinutes,
    setPreference,
    showReportingInterval,
    showObservationStatusSettings,
    observationRetentionWindow,
    intentStatusReportsEnabled,
    intentStatusBootstrapCompliantDelay,
    stopSequencesText,
    systemPromptCustomized,
    systemPromptDraft,
    temperature,
  ]);

  if (!open) {
    return null;
  }

  const selectedApiBaseUrl = apiBaseUrlSelectValue(apiBaseUrl, apiBaseUrlPresetOptions);
  const selectedModel = modelSelectValue(model, listedModels, customModelMode);
  const fewShotCount = systemPromptCustomized
    ? fewShotMessages.length ||
      normalizeModelfileOrSystemPrompt(systemPromptDraft).fewShotMessages.length
    : 0;

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
          Live defaults come from the agent (<code>/v1/agent/info</code>), with{" "}
          <code>.env</code> only as fallback. Saved values here are browser session overrides
          sent on the next A2A messages — they do not rewrite the agent&apos;s{" "}
          <code>.env</code>. Leave model or API URL empty to use the agent default for the
          selected provider.
        </p>
        {hasStored ? (
          <p className="workspace-hint" role="status">
            Browser session override is active for this agent (may differ from the live agent
            default).
          </p>
        ) : null}

        <label className="workspace-label" htmlFor="workspace-agent-settings-provider">
          Provider
        </label>
        <select
          className="workspace-select"
          disabled={loadingRuntime}
          id="workspace-agent-settings-provider"
          onChange={(event) =>
            handleProviderChange(
              event.target.value === "anthropic" ? "anthropic" : "openai",
            )
          }
          value={provider}
        >
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
        </select>
        <p className="workspace-hint">
          {loadingRuntime
            ? "Loading live agent default…"
            : `Live agent default: ${runtimeProvider}`}
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
          <option value="">Use agent default</option>
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
            placeholder={
              isAnthropic ? "https://api.anthropic.com" : "https://host:port/v1"
            }
            spellCheck={false}
            type="url"
            value={customApiUrlDraft}
          />
        ) : null}
        <p className="workspace-hint">
          {isAnthropic
            ? "Anthropic Messages API base (default https://api.anthropic.com)."
            : (
              <>
                OpenAI-compatible endpoint base, including <code>/v1</code> when required (Ollama)
                or <code>/api</code> for Open WebUI.
              </>
            )}
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
            {!isAnthropic && loadingModels && listedModels.length === 0
              ? "Loading models…"
              : defaultModelOptionLabel}
          </option>
          {listedModels.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          {model.trim() && !listedModels.includes(model.trim()) ? (
            <option value={model.trim()}>{model.trim()}</option>
          ) : null}
          <option value={CUSTOM_MODEL_OPTION}>Custom model…</option>
        </select>
        {showCustomModelInput ? (
          <input
            className="workspace-input"
            disabled={!isAnthropic && loadingModels}
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
        {!isAnthropic && loadingModels && listedModels.length > 0 ? (
          <p className="workspace-hint">Refreshing model list…</p>
        ) : null}
        {isAnthropic ? (
          <p className="workspace-hint">
            Curated Anthropic model suggestions; use Custom model for any other id.
          </p>
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
            ? "Loading live agent default…"
            : hasStored
              ? `Live agent default: ${runtimeTemperature}`
              : `Using live agent default: ${runtimeTemperature}`}
        </p>

        {!isAnthropic ? (
          <>
            <label className="workspace-label" htmlFor="workspace-agent-settings-num-ctx">
              Context window (num_ctx)
            </label>
            <input
              className="workspace-input"
              id="workspace-agent-settings-num-ctx"
              min={1}
              onChange={(event) => setNumCtxDraft(event.target.value)}
              placeholder="Provider / model default"
              step={1}
              type="number"
              value={numCtxDraft}
            />
            <p className="workspace-hint">
              {typeof runtimeDefaults?.numCtx === "number"
                ? `Agent environment default: ${runtimeDefaults.numCtx}. Honored for Ollama-compatible APIs via options.num_ctx.`
                : "Optional. Honored for Ollama-compatible APIs via options.num_ctx. Leave empty for the provider default."}
            </p>
          </>
        ) : null}

        <div className="workspace-agent-settings-label-row">
          <label className="workspace-label" htmlFor="workspace-agent-settings-stop">
            Stop sequences
          </label>
          <button
            aria-expanded={stopHelpOpen}
            aria-label="About stop sequences"
            className="workspace-button workspace-button-secondary workspace-agent-settings-info-button"
            onClick={() => setStopHelpOpen((openHelp) => !openHelp)}
            type="button"
          >
            i
          </button>
        </div>
        {stopHelpOpen ? (
          <div className="workspace-agent-settings-stop-help" role="note">
            {STOP_SEQUENCES_HELP_TEXT.split("\n").map((line, index) => (
              <p key={`stop-help-${index}`}>{line}</p>
            ))}
          </div>
        ) : null}
        <textarea
          className="workspace-input workspace-agent-settings-stop-textarea"
          id="workspace-agent-settings-stop"
          onChange={(event) => setStopSequencesText(event.target.value)}
          placeholder={"One stop string per line\ne.g. <|eot_id|>"}
          spellCheck={false}
          value={stopSequencesText}
        />
        <p className="workspace-hint">
          {runtimeDefaults?.stopSequences?.length
            ? `Agent environment default: ${runtimeDefaults.stopSequences.join(", ")}. Leave empty to send no stop sequences.`
            : "Leave empty to send no stop sequences."}
        </p>

        <div className="workspace-agent-settings-label-row">
          <label className="workspace-label" htmlFor="workspace-agent-settings-system-prompt">
            System prompt
          </label>
          {systemPromptCustomized ? (
            <button
              className="workspace-button workspace-button-secondary"
              onClick={handleRevertSystemPrompt}
              type="button"
            >
              Revert to default
            </button>
          ) : null}
        </div>
        <textarea
          className="workspace-input workspace-agent-settings-system-prompt"
          id="workspace-agent-settings-system-prompt"
          onChange={(event) => {
            setSystemPromptCustomized(true);
            setSystemPromptDraft(event.target.value);
          }}
          placeholder={
            loadingRuntime
              ? "Loading agent default system prompt…"
              : "Agent default system prompt"
          }
          spellCheck={false}
          value={systemPromptDraft}
        />
        <p className="workspace-hint">
          Shows the agent default until you edit it. Paste plain system text or a full Ollama
          Modelfile (<code>SYSTEM</code> / <code>MESSAGE</code> / <code>PARAMETER</code>); Save
          normalizes Modelfile content and syncs temperature, num_ctx, and stop.
          {fewShotCount > 0
            ? ` ${fewShotCount} few-shot MESSAGE pair${fewShotCount === 1 ? "" : "s"} will be sent.`
            : null}
          {!systemPromptCustomized && loadingRuntime ? " Loading default…" : null}
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

        {showObservationStatusSettings ? (
          <>
            <label className="workspace-label" htmlFor="workspace-agent-settings-status-reports">
              <input
                checked={intentStatusReportsEnabled}
                id="workspace-agent-settings-status-reports"
                onChange={(event) => setIntentStatusReportsEnabled(event.target.checked)}
                type="checkbox"
              />{" "}
              Intent status reports
            </label>
            <p className="workspace-hint">
              Off by default. When on, schema-synth attaches an IntentStatusEvaluator and DSL
              requires one multi-metric observation-report per intent (or set{" "}
              <code>`status_reports=on`</code> in instructions).
            </p>
            <label
              className="workspace-label"
              htmlFor="workspace-agent-settings-retention"
            >
              Status retention window
            </label>
            <input
              className="workspace-input"
              id="workspace-agent-settings-retention"
              onChange={(event) => setObservationRetentionWindow(event.target.value)}
              placeholder={DEFAULT_OBSERVATION_RETENTION_WINDOW}
              type="text"
              value={observationRetentionWindow}
            />
            <p className="workspace-hint">
              Default {DEFAULT_OBSERVATION_RETENTION_WINDOW}. Duration for compliance samples
              (e.g. <code>5m</code>, <code>60s</code>). Overridable via{" "}
              <code>`retention=…`</code> in instructions.
            </p>
            <label
              className="workspace-label"
              htmlFor="workspace-agent-settings-bootstrap-delay"
            >
              Status bootstrap delay
            </label>
            <input
              className="workspace-input"
              id="workspace-agent-settings-bootstrap-delay"
              onChange={(event) => setIntentStatusBootstrapCompliantDelay(event.target.value)}
              placeholder={DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY}
              type="text"
              value={intentStatusBootstrapCompliantDelay}
            />
            <p className="workspace-hint">
              Default {DEFAULT_INTENT_STATUS_BOOTSTRAP_DELAY}. Delay after{" "}
              <code>StateIntentReceived</code> before first <code>StateCompliant</code>.
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
          <button
            className="workspace-button workspace-button-secondary"
            disabled={loadingRuntime}
            onClick={handleResetToAgentDefaults}
            type="button"
          >
            Reset to agent defaults
          </button>
          <button className="workspace-button" onClick={handleSave} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
