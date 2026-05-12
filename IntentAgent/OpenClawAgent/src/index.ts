import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, type AppConfig } from "./config.js";
import { createOpenClawModelInvoker } from "./adapters/openclaw.js";
import { createSession, TurnOrchestrator } from "./core/turnOrchestrator.js";
import { loadDomainPackage } from "./core/packageLoader.js";
import { shutdownObservationStreamsIfPresent, tryReplPackageHook } from "./core/replPackageHook.js";
import {
  buildAgentCard,
  persistAgentCard,
  registerAgentCard,
  type A2AConfig
} from "./core/a2a/service.js";
import { startOpenApiServer } from "./core/httpApiServer.js";
import {
  applyPackageMappingEnvDefaults,
  readDotEnvKey,
  updateEnvFile
} from "./core/envConfigWriter.js";
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

function emitA2AResult(label: string, result: { ok: boolean; message: string; wellKnownURI?: string }): void {
  if (result.ok) {
    process.stdout.write(`[A2A] ${label}: ${result.message}\n`);
    if (result.wellKnownURI) {
      process.stdout.write(`[A2A] wellKnownURI=${result.wellKnownURI}\n`);
    }
    return;
  }
  process.stderr.write(`[A2A] ${label}: ${result.message}\n`);
  if (result.wellKnownURI) {
    process.stderr.write(
      `[A2A] Registry agent card GET target (POST body wellKnownURI): ${result.wellKnownURI}\n`
    );
  }
}

function a2aSlice(config: AppConfig): A2AConfig {
  return {
    a2aEnabled: config.a2aEnabled,
    a2aRegistryBaseUrl: config.a2aRegistryBaseUrl,
    a2aAgentBaseUrl: config.a2aAgentBaseUrl,
    a2aAgentCardPath: config.a2aAgentCardPath,
    a2aAutoRegisterOnStartup: config.a2aAutoRegisterOnStartup
  };
}

async function registerAgentCardAfterHttpListen(config: AppConfig, cardName: string): Promise<void> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await registerAgentCard(a2aSlice(config), cardName);
    if (result.ok) {
      emitA2AResult("startup", result);
      return;
    }
    if (attempt < maxAttempts) {
      const delayMs = 250 * 2 ** (attempt - 1);
      const cardUrlNote = result.wellKnownURI
        ? `; registry would fetch agent card from ${result.wellKnownURI}`
        : "";
      process.stderr.write(
        `[A2A] startup: registration attempt ${attempt} failed${cardUrlNote}; retrying in ${delayMs}ms...\n`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      emitA2AResult("startup", result);
      if (/502|503|504|Bad Gateway|gateway/i.test(result.message)) {
        const cardPath = config.a2aAgentCardPath;
        process.stderr.write(
          "[A2A] HTTP 5xx from the card URL usually means the reverse proxy cannot reach this process " +
            `(listening on ${config.apiServerHost}:${config.apiServerPort}). On the agent host run ` +
            `\`curl -sS -w "\\n%{http_code}\\n" http://127.0.0.1:${config.apiServerPort}${cardPath}\`. ` +
            `From the Caddy container run \`curl -sS http://host.docker.internal:${config.apiServerPort}${cardPath}\`. ` +
            "Use API_SERVER_HOST=0.0.0.0 (default) so Docker can reach the agent; reload Caddy after Caddyfile edits; " +
            "ensure A2A_AGENT_BASE_URL matches the HTTPS path Caddy exposes.\n"
        );
      }
    }
  }
}

async function prepareAndRegisterA2A(
  config: A2AConfig,
  domainPackage: ReturnType<TurnOrchestrator["getDomainPackage"]>,
  cwd: string,
  reason: "startup" | "package_load",
  opts?: { deferRegistryRegistration?: boolean }
): Promise<void> {
  if (!config.a2aEnabled) return;
  const card = buildAgentCard(config, domainPackage);
  persistAgentCard(cwd, card, config.a2aAgentCardPath);
  if (reason === "package_load") {
    process.stdout.write(
      "[A2A] package_load: registration deferred until the cloned agent HTTP server is started.\n"
    );
    return;
  }
  if (opts?.deferRegistryRegistration) {
    return;
  }
  if (reason === "startup" && !config.a2aAutoRegisterOnStartup) {
    process.stdout.write("[A2A] startup auto-registration disabled.\n");
    return;
  }
  const result = await registerAgentCard(config, card.name);
  emitA2AResult(reason, result);
}

function boolLike(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function loadA2AConfigFromEnv(): A2AConfig {
  const rawEnabled = process.env.A2A_ENABLED ?? readDotEnvValue("A2A_ENABLED");
  const rawRegistry = process.env.A2A_REGISTRY_BASE_URL ?? readDotEnvValue("A2A_REGISTRY_BASE_URL");
  const rawAgentBase = process.env.A2A_AGENT_BASE_URL ?? readDotEnvValue("A2A_AGENT_BASE_URL");
  const rawCardPath = process.env.A2A_AGENT_CARD_PATH ?? readDotEnvValue("A2A_AGENT_CARD_PATH");
  const rawAuto =
    process.env.A2A_AUTO_REGISTER_ON_STARTUP ?? readDotEnvValue("A2A_AUTO_REGISTER_ON_STARTUP");
  return {
    a2aEnabled: boolLike(rawEnabled, false),
    a2aRegistryBaseUrl: rawRegistry?.trim() || "http://localhost:8000",
    a2aAgentBaseUrl: rawAgentBase?.trim() || "http://localhost:3010",
    a2aAgentCardPath: rawCardPath?.trim() || "/.well-known/agent-card.json",
    a2aAutoRegisterOnStartup: boolLike(rawAuto, true)
  };
}

/** Read A2A settings from `agentDir/.env` (used after `package load` when `process.cwd()` is still the baseline). */
function loadA2AConfigFromDirectory(agentDir: string): A2AConfig {
  const envPath = join(agentDir, ".env");
  const pick = (key: string): string | undefined => {
    const fileVal = readDotEnvKey(envPath, key);
    if (fileVal !== undefined && fileVal !== "") return fileVal;
    const procVal = process.env[key];
    return procVal?.trim();
  };
  return {
    a2aEnabled: boolLike(pick("A2A_ENABLED"), false),
    a2aRegistryBaseUrl: pick("A2A_REGISTRY_BASE_URL")?.trim() || "http://localhost:8000",
    a2aAgentBaseUrl: pick("A2A_AGENT_BASE_URL")?.trim() || "http://localhost:3010",
    a2aAgentCardPath: pick("A2A_AGENT_CARD_PATH")?.trim() || "/.well-known/agent-card.json",
    a2aAutoRegisterOnStartup: boolLike(pick("A2A_AUTO_REGISTER_ON_STARTUP"), true)
  };
}

interface CliOptions {
  debug: boolean;
  noGraphDB: boolean;
  debugLogPath: string;
  /** When set, overrides `API_SERVER_PORT` from the environment before config load. */
  apiServerPort?: number;
  prompt: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  let debug = false;
  let noGraphDB = false;
  let debugLogPath = "logs/openclaw-agent-debug.jsonl";
  let apiServerPort: number | undefined;
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--port" || token.startsWith("--port=")) {
      let raw: string;
      if (token.startsWith("--port=")) {
        raw = token.slice("--port=".length).trim();
      } else {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          throw new Error("Usage: --port <1-65535> (sets API_SERVER_PORT for the OpenAPI listener).");
        }
        raw = next.trim();
        i += 1;
      }
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid --port ${JSON.stringify(raw)}: expected an integer 1-65535.`);
      }
      apiServerPort = parsed;
      continue;
    }
    if (token === "--debug") {
      debug = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        debugLogPath = next;
        i += 1;
      }
      continue;
    }
    if (token === "--noGraphDB") {
      noGraphDB = true;
      continue;
    }
    promptParts.push(token);
  }
  return { debug, noGraphDB, debugLogPath, apiServerPort, prompt: promptParts.join(" ").trim() };
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

function packageLoadEnabled(): boolean {
  const raw = process.env.ENABLE_PACKAGE_LOAD ?? readDotEnvValue("ENABLE_PACKAGE_LOAD");
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}

function readDotEnvValue(key: string): string | undefined {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return undefined;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const parsedKey = line.slice(0, eq).trim();
    if (parsedKey !== key) continue;
    return line.slice(eq + 1).trim();
  }
  return undefined;
}

async function runPackageLoadCommand(argv: string[]): Promise<boolean> {
  const command = parsePackageLoadCommand(argv);
  if (!command) return false;
  if (!packageLoadEnabled()) {
    throw new Error("Package load is disabled in this cloned agent.");
  }

  const { installPackageFromPath } = await import("./core/packageInstaller.js");
  const { cloneAgentForPackage } = await import("./core/agentCloneManager.js");
  const { deployPackageToClone } = await import("./core/packageCloneDeployer.js");
  const { deployPackageToolsToClone } = await import("./core/packageToolDeployer.js");
  const { pruneClonePackagingArtifacts } = await import("./core/cloneRuntimePruner.js");

  const baselineAgentDir = process.cwd();
  const packagesRoot = resolve(baselineAgentDir, "../OpenClawPackages");
  const installed = installPackageFromPath({
    sourcePath: command.archivePath,
    packagesRoot
  });
  const installedPackage = loadDomainPackage(installed.packageDir);
  const cloneFolderName = installedPackage.agentCardPartial?.name ?? installed.packageName;
  const cloned = cloneAgentForPackage({
    baselineAgentDir,
    packageName: installed.packageName,
    folderName: cloneFolderName
  });
  const deployedPackage = await deployPackageToClone({
    packageDir: installed.packageDir,
    cloneDir: cloned.cloneDir,
    packageName: installed.packageName
  });
  const deployedTools = deployPackageToolsToClone({
    packageDir: deployedPackage.deployedPackageDir,
    cloneDir: cloned.cloneDir
  });
  const domainPackageValue = "./";
  const deployedSkillPath = join(cloned.cloneDir, "skills", "SKILL.md");
  const skillFileValue = normalizeEnvPath(relative(cloned.cloneDir, deployedSkillPath));
  const cloneEnvPath = join(cloned.cloneDir, ".env");
  updateEnvFile(cloneEnvPath, [
    { key: "DOMAIN_PACKAGE_DIR", value: domainPackageValue },
    { key: "SKILL_FILE", value: skillFileValue },
    { key: "ENABLE_PACKAGE_LOAD", value: "false" }
  ]);
  applyPackageMappingEnvDefaults(cloneEnvPath, installed.packageDir);
  const cloneConfig = loadA2AConfigFromDirectory(cloned.cloneDir);
  const clonePackage = loadDomainPackage(cloned.cloneDir);
  await prepareAndRegisterA2A(cloneConfig, clonePackage, cloned.cloneDir, "package_load");
  pruneClonePackagingArtifacts(cloned.cloneDir);

  process.stdout.write(`Package installed: ${installed.packageName}\n`);
  process.stdout.write(`Package directory: ${installed.packageDir}\n`);
  process.stdout.write(`Agent clone: ${cloned.cloneDir}\n`);
  process.stdout.write(`Clone version: ${cloned.version}\n`);
  process.stdout.write(`Cloned package copy: ${cloned.cloneDir}\n`);
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

function extractIntentTurtle(responseText: string): { intentId: string; turtle: string } | null {
  const trimmed = responseText.trim();
  const fenced = trimmed.match(/^```(?:turtle|ttl)?\s*([\s\S]*?)\s*```$/i);
  const turtle = (fenced?.[1] ?? trimmed).trim();
  if (!turtle.includes("icm:Intent")) return null;
  const idMatch = turtle.match(/\bdata5g:(I[a-f0-9]{32}|I[a-f0-9-]{36})\b/i);
  if (!idMatch?.[1]) return null;
  return { intentId: idMatch[1], turtle };
}

function writeIntentTurtleDebugFile(debugLogPath: string, responseText: string): void {
  const extracted = extractIntentTurtle(responseText);
  if (!extracted) return;
  const logsDir = dirname(debugLogPath);
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  const filePath = join(logsDir, `${extracted.intentId}.ttl`);
  writeFileSync(filePath, `${extracted.turtle}\n`, "utf8");
}

async function runOneShot(
  orchestrator: TurnOrchestrator,
  prompt: string,
  debug: boolean,
  debugLogPath: string,
  writeIntentTurtleDebug: boolean
): Promise<void> {
  const session = createSession();
  const result = await orchestrator.runTurn(session, prompt);
  appendDebugLog(debug, debugLogPath, session, prompt, result);
  if (writeIntentTurtleDebug) {
    writeIntentTurtleDebugFile(resolve(process.cwd(), debugLogPath), result.response);
  }
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
  debugLogPath: string,
  writeIntentTurtleDebug: boolean
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
      const cfg = orchestrator.getAppConfig();
      const hook = await tryReplPackageHook({
        line: userText,
        session,
        domainPackage: orchestrator.getDomainPackage(),
        debug,
        debugLogPath,
        graphDbEndpoint: cfg.graphDbEndpoint,
        graphDbNamedGraph: cfg.graphDbNamedGraph,
        graphDbQueryLimit: cfg.graphDbQueryLimit
      });
      if (hook.handled) {
        const synthetic: AgentTurnResult = {
          response: hook.assistantText ?? "",
          warnings: [],
          debug: ["repl_package_hook_handled=true"]
        };
        appendDebugLog(debug, debugLogPath, session, userText, synthetic);
        session.messages.push({ role: "user", text: userText, createdAt: new Date().toISOString() });
        if (hook.assistantText) {
          session.messages.push({
            role: "assistant",
            text: hook.assistantText,
            createdAt: new Date().toISOString()
          });
          process.stdout.write(`\nAssistant:\n${hook.assistantText}\n\n`);
        }
        continue;
      }
      const result = await orchestrator.runTurn(session, userText);
      appendDebugLog(debug, debugLogPath, session, userText, result);
      if (writeIntentTurtleDebug) {
        writeIntentTurtleDebugFile(resolve(process.cwd(), debugLogPath), result.response);
      }
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
    await shutdownObservationStreamsIfPresent(orchestrator.getDomainPackage().packageDir);
    rl.close();
  }
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const argv = process.argv.slice(2);
  const execution = (async () => {
    const handled = await runPackageLoadCommand(argv);
    if (handled) return;
    const options = parseCliOptions(argv);
    if (options.apiServerPort !== undefined) {
      process.env.API_SERVER_PORT = String(options.apiServerPort);
    }
    const orchestrator = createAgentRuntime();
    const runtimePatches = orchestrator.getDomainPackage().manifest.runtimePatches;
    if (options.noGraphDB) {
      if (runtimePatches?.cliNoGraphDbFlag) {
        process.env.NO_GRAPHDB = "true";
        process.stdout.write("`--noGraphDB` mode acknowledged. GraphDB writes will be skipped and payloads printed.\n");
      } else {
        process.stdout.write("`--noGraphDB` ignored because this package does not enable cliNoGraphDbFlag.\n");
      }
    }
    const appConfig = orchestrator.getAppConfig();
    await prepareAndRegisterA2A(
      appConfig,
      orchestrator.getDomainPackage(),
      process.cwd(),
      "startup",
      {
        deferRegistryRegistration: appConfig.apiServerEnabled && !options.prompt
      }
    );
    if (options.prompt) {
      await runOneShot(
        orchestrator,
        options.prompt,
        options.debug,
        options.debugLogPath,
        runtimePatches?.writeIntentTurtleDebugFile === true
      );
      return;
    }
    const config = orchestrator.getAppConfig();
    if (config.apiServerEnabled) {
      const card = buildAgentCard(config, orchestrator.getDomainPackage());
      persistAgentCard(process.cwd(), card, config.a2aAgentCardPath);
      const server = startOpenApiServer({
        runtime: orchestrator,
        host: config.apiServerHost,
        port: config.apiServerPort,
        agentCardPath: config.a2aAgentCardPath,
        agentCard: card
      });
      const listening = await server.listen();
      process.stdout.write(
        `OpenAPI server running on http://${listening.host}:${listening.port} (openapi: /openapi.json)\n`
      );
      if (config.a2aEnabled) {
        if (!config.a2aAutoRegisterOnStartup) {
          process.stdout.write("[A2A] startup auto-registration disabled.\n");
        } else {
          await registerAgentCardAfterHttpListen(config, card.name);
        }
      }
      const shutdown = async () => {
        await server.close();
        process.exit(0);
      };
      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());
      return;
    }
    await runInteractive(
      orchestrator,
      options.debug,
      options.debugLogPath,
      runtimePatches?.writeIntentTurtleDebugFile === true
    );
  })();
  execution.catch((error) => {
    process.stderr.write(`Error: ${String(error)}\n`);
    process.exit(1);
  });
}
