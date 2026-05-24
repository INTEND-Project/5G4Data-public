import type { AppConfig } from "../config.js";
import type { ModelInvocationResult } from "../models.js";

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

function normalizeModel(model: string, provider: "openai" | "anthropic"): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

async function invokeOpenAi(
  config: AppConfig,
  messages: ModelMessage[],
  stage: string
): Promise<ModelInvocationResult> {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  const started = Date.now();
  const response = await fetch(`${config.openAiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: normalizeModel(config.openClawModel || config.openAiModel, "openai"),
      messages
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
      stage,
      provider: "openai",
      model: normalizeModel(config.openClawModel || config.openAiModel, "openai"),
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
  stage: string
): Promise<ModelInvocationResult> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
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
      model: normalizeModel(config.openClawModel || config.anthropicModel, "anthropic"),
      max_tokens: 4096,
      temperature: 0,
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
  return (
    {
      text:
        payload.content
          ?.filter((item) => item.type === "text" && typeof item.text === "string")
          .map((item) => item.text)
          .join("\n")
          .trim() ?? "",
      call: {
        stage,
        provider: "anthropic",
        model: normalizeModel(config.openClawModel || config.anthropicModel, "anthropic"),
        usage: {
          inputTokens,
          outputTokens,
          totalTokens
        },
        latencyMs: Date.now() - started,
        requestId: payload.id,
        usageKnown: payload.usage !== undefined
      }
    }
  );
}

export function createOpenClawModelInvoker(config: AppConfig) {
  return async (
    messages: ModelMessage[],
    metadata: { stage: string } = { stage: "main_turn" }
  ): Promise<ModelInvocationResult> => {
    if (config.llmProvider === "anthropic") {
      return invokeAnthropic(config, messages, metadata.stage);
    }
    return invokeOpenAi(config, messages, metadata.stage);
  };
}
