import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/** Resolve OpenAI API key from Controller env or SimulatorAgentKernel `.env`. */
export function resolveOpenAiApiKey(source: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromController = source.OPENAI_API_KEY?.trim();
  if (fromController) return fromController;

  const kernelEnv = resolve(process.cwd(), "../SimulatorAgentKernel/.env");
  const fromKernel = readDotEnvKey(kernelEnv, "OPENAI_API_KEY")?.trim();
  return fromKernel || undefined;
}
