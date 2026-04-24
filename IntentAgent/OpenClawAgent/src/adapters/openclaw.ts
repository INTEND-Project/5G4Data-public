import type { AppConfig } from "../config.js";

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

function normalizeModel(model: string, provider: "openai" | "anthropic"): string {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

async function invokeOpenAi(config: AppConfig, messages: ModelMessage[]): Promise<string> {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
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
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

async function invokeAnthropic(config: AppConfig, messages: ModelMessage[]): Promise<string> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
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
    content?: Array<{ type?: string; text?: string }>;
  };
  return (
    payload.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim() ?? ""
  );
}

export function createOpenClawModelInvoker(config: AppConfig) {
  return async (messages: ModelMessage[]): Promise<string> => {
    if (config.llmProvider === "anthropic") {
      return invokeAnthropic(config, messages);
    }
    return invokeOpenAi(config, messages);
  };
}
