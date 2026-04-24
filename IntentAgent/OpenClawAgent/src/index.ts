import { readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { createOpenClawModelInvoker } from "./adapters/openclaw.js";
import { createSession, TurnOrchestrator } from "./core/turnOrchestrator.js";

export function createAgentRuntime() {
  const config = loadConfig();
  const skillText = readFileSync(config.skillFile, "utf8");
  const systemPromptText = readFileSync(config.systemPromptFile, "utf8");
  const invokeModel = createOpenClawModelInvoker(config);
  return new TurnOrchestrator(config, skillText, systemPromptText, invokeModel);
}

async function runOneShot(orchestrator: TurnOrchestrator, prompt: string): Promise<void> {
  const session = createSession();
  const result = await orchestrator.runTurn(session, prompt);
  process.stdout.write(`${result.response}\n`);
  if (result.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${result.warnings.join("\n- ")}\n`);
  }
}

async function runInteractive(orchestrator: TurnOrchestrator): Promise<void> {
  const session = createSession();
  const rl = readline.createInterface({ input, output });
  process.stdout.write("Interactive mode. Type 'exit' or 'quit' to stop.\n");
  try {
    while (true) {
      const userText = (await rl.question("You> ")).trim();
      if (!userText) continue;
      if (userText.toLowerCase() === "exit" || userText.toLowerCase() === "quit") {
        break;
      }
      const result = await orchestrator.runTurn(session, userText);
      process.stdout.write(`\nAssistant:\n${result.response}\n\n`);
      if (result.warnings.length > 0) {
        process.stdout.write(`Warnings:\n- ${result.warnings.join("\n- ")}\n\n`);
      }
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const orchestrator = createAgentRuntime();
  const prompt = process.argv.slice(2).join(" ").trim();
  const execution = prompt ? runOneShot(orchestrator, prompt) : runInteractive(orchestrator);
  execution.catch((error) => {
    process.stderr.write(`Error: ${String(error)}\n`);
    process.exit(1);
  });
}
