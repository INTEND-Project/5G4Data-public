import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_AGENT_TEMPERATURE } from "@/lib/agents/agent-llm-preferences";
import {
  INTENT_GENERATING_AGENT_NAME,
  INTENT_GENERATING_AGENT_PACKAGE,
  OBSERVATION_GENERATING_AGENT_NAME,
  OBSERVATION_GENERATING_AGENT_PACKAGE,
} from "@/lib/agents/known-agent-names";

export type AgentRuntimeLlmDefaults = {
  model: string;
  temperature: number;
  source: "agent" | "env";
};

function readDotEnvKey(envFilePath: string, key: string): string | undefined {
  if (!existsSync(envFilePath)) return undefined;
  const text = readFileSync(envFilePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const existingKey = line.slice(0, index).trim();
    if (existingKey !== key) continue;
    return line.slice(index + 1).trim();
  }
  return undefined;
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENT_TEMPERATURE;
  return Math.min(2, Math.max(0, value));
}

function parseTemperature(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_AGENT_TEMPERATURE;
  const parsed = Number.parseFloat(raw.trim());
  return clampTemperature(parsed);
}

function cloneEnvPathForAgent(agentName: string): string | undefined {
  const root = resolve(process.cwd(), "..");
  const packageDirByAgent: Record<string, string> = {
    [INTENT_GENERATING_AGENT_NAME]: INTENT_GENERATING_AGENT_PACKAGE,
    [OBSERVATION_GENERATING_AGENT_NAME]: OBSERVATION_GENERATING_AGENT_PACKAGE,
  };
  const packageDir = packageDirByAgent[agentName];
  if (!packageDir) {
    return undefined;
  }
  return resolve(root, "agents", packageDir, ".env");
}

/** Read model/temperature from a known agent clone `.env` or baseline kernel `.env`. */
export function readEnvFileLlmDefaults(agentName: string): AgentRuntimeLlmDefaults | null {
  const candidates = [
    cloneEnvPathForAgent(agentName),
    resolve(process.cwd(), "../SimulatorAgentKernel/.env"),
  ].filter((path): path is string => Boolean(path));

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const openAiModel = readDotEnvKey(envPath, "OPENAI_MODEL");
    const openClawModel = readDotEnvKey(envPath, "OPENCLAW_MODEL");
    const model = (openClawModel ?? openAiModel)?.trim();
    if (!model) continue;
    return {
      model,
      temperature: parseTemperature(readDotEnvKey(envPath, "OPENAI_TEMPERATURE")),
      source: "env",
    };
  }

  return null;
}
