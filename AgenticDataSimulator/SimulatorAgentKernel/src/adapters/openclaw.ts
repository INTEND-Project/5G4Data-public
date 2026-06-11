import type { AppConfig } from "../config.js";
import type { ModelInvocationResult, ModelInvokeOptions } from "../models.js";

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

function normalizeModel(model: string, provider: "openai" | "anthropic"): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function resolveModel(
  config: AppConfig,
  provider: "openai" | "anthropic",
  override?: string | null
): string {
  const fallback =
    provider === "openai"
      ? config.openClawModel || config.openAiModel
      : config.openClawModel || config.anthropicModel;
  const raw = override?.trim() || fallback;
  return normalizeModel(raw, provider);
}

function resolveTemperature(config: AppConfig, override?: number | null): number {
  if (override !== undefined && override !== null && Number.isFinite(override)) {
    return override;
  }
  return config.openAiTemperature;
}

async function invokeOpenAi(
  config: AppConfig,
  messages: ModelMessage[],
  options: ModelInvokeOptions
): Promise<ModelInvocationResult> {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  const model = resolveModel(config, "openai", options.llmModel);
  const temperature = resolveTemperature(config, options.temperature);
  const started = Date.now();
  const response = await fetch(`${config.openAiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      ...(temperature !== 0 ? { temperature } : {})
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }
  const payload = (await response.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const inputTokens = payload.usage?.prompt_tokens ?? 0;
  const outputTokens = payload.usage?.completion_tokens ?? 0;
  const totalTokens = payload.usage?.total_tokens ?? inputTokens + outputTokens;
  return {
    text: payload.choices?.[0]?.message?.content?.trim() ?? "",
    call: {
      stage: options.stage,
      provider: "openai",
      model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens
      },
      latencyMs: Date.now() - started,
      requestId: payload.id,
      usageKnown: payload.usage !== undefined
    }
  };
}

async function invokeAnthropic(
  config: AppConfig,
  messages: ModelMessage[],
  options: ModelInvokeOptions
): Promise<ModelInvocationResult> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  const model = resolveModel(config, "anthropic", options.llmModel);
  const temperature = resolveTemperature(config, options.temperature);
  const started = Date.now();
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const conversation = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const response = await fetch(`${config.anthropicBaseUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature,
      system,
      messages: conversation
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${errorText}`);
  }
  const payload = (await response.json()) as {
    id?: string;
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const inputTokens = payload.usage?.input_tokens ?? 0;
  const outputTokens = payload.usage?.output_tokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  return {
    text:
      payload.content
        ?.filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n")
        .trim() ?? "",
    call: {
      stage: options.stage,
      provider: "anthropic",
      model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens
      },
      latencyMs: Date.now() - started,
      requestId: payload.id,
      usageKnown: payload.usage !== undefined
    }
  };
}

export function createOpenClawModelInvoker(config: AppConfig) {
  return async (
    messages: ModelMessage[],
    options: ModelInvokeOptions = { stage: "main_turn" }
  ): Promise<ModelInvocationResult> => {
    if (config.llmProvider === "anthropic") {
      return invokeAnthropic(config, messages, options);
    }
    return invokeOpenAi(config, messages, options);
  };
}
