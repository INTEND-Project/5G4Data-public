import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "./config.js";
import { createOpenClawModelInvoker } from "./adapters/openclaw.js";
import { createSession, TurnOrchestrator } from "./core/turnOrchestrator.js";
import { loadDomainPackage } from "./core/packageLoader.js";
import { installPackageFromPath } from "./core/packageInstaller.js";
import { cloneAgentForPackage } from "./core/agentCloneManager.js";
import { updateEnvFile } from "./core/envConfigWriter.js";
import { deployPackageToolsToClone } from "./core/packageToolDeployer.js";
import type { AgentTurnResult, ChatSession } from "./models.js";

export function createAgentRuntime() {
  const config = loadConfig();
  const domainPackage = loadDomainPackage(config.domainPackageDir);
  // Keep compatibility with external SKILL_FILE by prepending it to package system prompt.
  const skillText = readFileSync(config.skillFile, "utf8").trim();
  domainPackage.systemPromptText = `${domainPackage.systemPromptText}\n\n${skillText}`.trim();
  const invokeModel = createOpenClawModelInvoker(config);
  return new TurnOrchestrator(config, domainPackage, invokeModel);
}

interface CliOptions {
  debug: boolean;
  debugLogPath: string;
  prompt: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  let debug = false;
  let debugLogPath = "logs/openclaw-agent-debug.jsonl";
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--debug") {
      debug = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        debugLogPath = next;
        i += 1;
      }
      continue;
    }
    promptParts.push(token);
  }
  return { debug, debugLogPath, prompt: promptParts.join(" ").trim() };
}

function normalizeEnvPath(value: string): string {
  if (value === ".") return "./";
  if (value.startsWith(".") || value.startsWith("/")) return value;
  return `./${value}`;
}

function parsePackageLoadCommand(argv: string[]): { archivePath: string } | null {
  if (argv.length < 3) return null;
  if (argv[0] !== "package" || argv[1] !== "load") return null;
  const archivePath = argv[2];
  if (!archivePath) {
    throw new Error("Usage: npx tsx src/index.ts package load <path-to-package.tgz|path-to-package-dir>");
  }
  return { archivePath };
}

async function runPackageLoadCommand(argv: string[]): Promise<boolean> {
  const command = parsePackageLoadCommand(argv);
  if (!command) return false;

  const baselineAgentDir = process.cwd();
  const packagesRoot = resolve(baselineAgentDir, "../OpenClawPackages");
  const installed = installPackageFromPath({
    sourcePath: command.archivePath,
    packagesRoot
  });
  const cloned = cloneAgentForPackage({
    baselineAgentDir,
    packageName: installed.packageName
  });
  const deployedTools = deployPackageToolsToClone({
    packageDir: installed.packageDir,
    cloneDir: cloned.cloneDir
  });
  const domainPackageValue = normalizeEnvPath(relative(cloned.cloneDir, installed.packageDir));
  const skillFileValue = normalizeEnvPath(relative(cloned.cloneDir, installed.skillPath));
  updateEnvFile(join(cloned.cloneDir, ".env"), [
    { key: "DOMAIN_PACKAGE_DIR", value: domainPackageValue },
    { key: "SKILL_FILE", value: skillFileValue }
  ]);

  process.stdout.write(`Package installed: ${installed.packageName}\n`);
  process.stdout.write(`Package directory: ${installed.packageDir}\n`);
  process.stdout.write(`Agent clone: ${cloned.cloneDir}\n`);
  process.stdout.write(`Clone version: ${cloned.version}\n`);
  if (deployedTools.copiedToolFiles.length > 0) {
    process.stdout.write(`Copied package tools: ${deployedTools.copiedToolFiles.join(", ")}\n`);
  }
  process.stdout.write(
    `Run with: cd "${cloned.cloneDir}" && npx tsx src/index.ts --debug\n`
  );
  return true;
}

function appendDebugLog(
  enabled: boolean,
  debugLogPath: string,
  session: ChatSession,
  userText: string,
  result: AgentTurnResult
): void {
  if (!enabled) return;
  const absolutePath = resolve(process.cwd(), debugLogPath);
  const parent = dirname(absolutePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  const entry = {
    timestampUtc: new Date().toISOString(),
    sessionId: session.sessionId,
    userText,
    assistantResponse: result.response,
    warnings: result.warnings,
    debugEntries: result.debug,
    usage: result.intentUsageSummary
  };
  appendFileSync(absolutePath, `${JSON.stringify(entry)}\n`, "utf8");
}

async function runOneShot(
  orchestrator: TurnOrchestrator,
  prompt: string,
  debug: boolean,
  debugLogPath: string
): Promise<void> {
  const session = createSession();
  const result = await orchestrator.runTurn(session, prompt);
  appendDebugLog(debug, debugLogPath, session, prompt, result);
  process.stdout.write(`${result.response}\n`);
  if (result.intentUsageSummary) {
    const usage = result.intentUsageSummary;
    const costText = usage.cost.pricingAvailable
      ? `$${usage.cost.estimatedTotalCostUsd?.toFixed(6) ?? "0.000000"}`
      : "n/a";
    process.stdout.write(
      `Usage (this intent): input ${usage.inputTokens}, output ${usage.outputTokens}, total ${usage.totalTokens} tokens, est. cost ${costText}\n`
    );
  }
  if (result.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${result.warnings.join("\n- ")}\n`);
  }
}

async function runInteractive(
  orchestrator: TurnOrchestrator,
  debug: boolean,
  debugLogPath: string
): Promise<void> {
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
      appendDebugLog(debug, debugLogPath, session, userText, result);
      process.stdout.write(`\nAssistant:\n${result.response}\n\n`);
      if (result.intentUsageSummary) {
        const usage = result.intentUsageSummary;
        const costText = usage.cost.pricingAvailable
          ? `$${usage.cost.estimatedTotalCostUsd?.toFixed(6) ?? "0.000000"}`
          : "n/a";
        process.stdout.write(
          `Usage (this intent): input ${usage.inputTokens}, output ${usage.outputTokens}, total ${usage.totalTokens} tokens, est. cost ${costText}\n\n`
        );
      }
      if (result.warnings.length > 0) {
        process.stdout.write(`Warnings:\n- ${result.warnings.join("\n- ")}\n\n`);
      }
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const argv = process.argv.slice(2);
  const execution = (async () => {
    const handled = await runPackageLoadCommand(argv);
    if (handled) return;
    const orchestrator = createAgentRuntime();
    const options = parseCliOptions(argv);
    if (options.prompt) {
      await runOneShot(orchestrator, options.prompt, options.debug, options.debugLogPath);
      return;
    }
    await runInteractive(orchestrator, options.debug, options.debugLogPath);
  })();
  execution.catch((error) => {
    process.stderr.write(`Error: ${String(error)}\n`);
    process.exit(1);
  });
}
