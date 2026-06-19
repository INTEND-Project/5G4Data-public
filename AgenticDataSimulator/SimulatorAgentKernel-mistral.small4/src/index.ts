import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig, type AppConfig } from "./config.js";
import { createOpenClawModelInvoker } from "./adapters/openclaw.js";
import {
  initializeMlflowTracing,
  shutdownMlflowTracing,
  wrapTracedModelInvoker
} from "./tracing/mlflowTracing.js";
import { createSession, TurnOrchestrator } from "./core/turnOrchestrator.js";
import { loadDomainPackage } from "./core/packageLoader.js";
import {
  shutdownObservationStreamsIfPresent,
  shutdownSyntheticRunsIfPresent
} from "./core/replPackageHook.js";
import {
  buildAgentCard,
  persistAgentCard,
  registerAgentCard,
  type A2AConfig
} from "./core/a2a/service.js";
import { startOpenApiServer } from "./core/httpApiServer.js";
import {
  applyPackageMappingEnvDefaults,
  applyPreservedAgentApiKeyFromEnv,
  ensureAgentApiKeyForClone,
  readDotEnvKey,
  syncAgentApiKeyToConsumers,
  syncGraphDbCredentialsToClone,
  updateEnvFile
} from "./core/envConfigWriter.js";
import {
  resolveE1IterationMlflowDescription,
  resolveE1IterationMlflowExperimentName,
  resolveE1IterationMlflowTrackingUriHost
} from "./core/e1IterationMlflow.js";
import { resolveMlflowExperimentId } from "./tracing/experimentResolver.js";
import type { AgentTurnResult, ChatSession } from "./models.js";
import {
  stripFrontmatter,
  stripMarkdownCodeFenceDelimiters
} from "./utils/prompting.js";

export function createAgentRuntime() {
  const config = loadConfig();
  const domainPackage = loadDomainPackage(config.domainPackageDir);
  // Keep compatibility with external SKILL_FILE by prepending it to package system prompt.
  const skillText = stripMarkdownCodeFenceDelimiters(
    stripFrontmatter(readFileSync(config.skillFile, "utf8"))
  ).trim();
  domainPackage.systemPromptText = `${domainPackage.systemPromptText}\n\n${skillText}`.trim();
  const invokeModel = wrapTracedModelInvoker(createOpenClawModelInvoker(config));
  return new TurnOrchestrator(config, domainPackage, invokeModel);
}

async function bootstrapMlflowTracing(
  orchestrator: TurnOrchestrator,
  agentCardName?: string
): Promise<void> {
  const config = orchestrator.getAppConfig();
  const domainPackage = orchestrator.getDomainPackage();
  const card = buildAgentCard(config, domainPackage);
  await initializeMlflowTracing(config, {
    agentName: agentCardName ?? card.name,
    packageName: domainPackage.manifest.name,
    packageVersion: domainPackage.manifest.version,
    apiPort: config.apiServerPort
  });
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
    a2aAutoRegisterOnStartup: config.a2aAutoRegisterOnStartup,
    agentApiKey: config.agentApiKey,
    agentApiKeyHeader: config.agentApiKeyHeader
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
    a2aAutoRegisterOnStartup: boolLike(rawAuto, true),
    agentApiKey:
      process.env.AGENT_API_KEY?.trim() || readDotEnvValue("AGENT_API_KEY")?.trim() || undefined,
    agentApiKeyHeader:
      process.env.AGENT_API_KEY_HEADER?.trim() ||
      readDotEnvValue("AGENT_API_KEY_HEADER")?.trim() ||
      "X-Api-Key"
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
    a2aAutoRegisterOnStartup: boolLike(pick("A2A_AUTO_REGISTER_ON_STARTUP"), true),
    agentApiKey: pick("AGENT_API_KEY") || undefined,
    agentApiKeyHeader: pick("AGENT_API_KEY_HEADER")?.trim() || "X-Api-Key"
  };
}

interface CliOptions {
  debug: boolean;
  noGraphDB: boolean;
  debugLogPath: string;
  /** Max NDJSON lines kept per metric in `logs/observations-<metric>.ndjson` (also `OBS_LOG_N` for child workers). */
  obsLogN: number;
  /** When set, overrides `API_SERVER_PORT` from the environment before config load. */
  apiServerPort?: number;
  prompt: string;
}

function parseCliOptions(argv: string[]): CliOptions {
  let debug = false;
  let noGraphDB = false;
  let debugLogPath = "logs/openclaw-agent-debug.jsonl";
  let obsLogN = 100;
  let apiServerPort: number | undefined;
  const promptParts: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--obsLogN" || token.startsWith("--obsLogN=")) {
      let raw: string;
      if (token.startsWith("--obsLogN=")) {
        raw = token.slice("--obsLogN=".length).trim();
      } else {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          throw new Error("Usage: --obsLogN <non-negative integer> (max lines per metric in logs/observations-<metric>.ndjson).");
        }
        raw = next.trim();
        i += 1;
      }
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --obsLogN ${JSON.stringify(raw)}: expected a non-negative integer.`);
      }
      obsLogN = parsed;
      continue;
    }
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
  return { debug, noGraphDB, debugLogPath, obsLogN, apiServerPort, prompt: promptParts.join(" ").trim() };
}

function normalizeEnvPath(value: string): string {
  if (value === ".") return "./";
  if (value.startsWith(".") || value.startsWith("/")) return value;
  return `./${value}`;
}

function parsePackageLoadCommand(
  argv: string[]
): { archivePath: string; skipContainer: boolean } | null {
  if (argv.length < 3) return null;
  if (argv[0] !== "package" || argv[1] !== "load") return null;
  const rest = argv.slice(2);
  const skipContainer = rest[0] === "--no-container";
  const archivePath = skipContainer ? rest[1] : rest[0];
  if (!archivePath) {
    throw new Error(
      "Usage: npx tsx src/index.ts package load [--no-container] <path-to-package.tgz|path-to-package-dir>"
    );
  }
  return { archivePath, skipContainer };
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
  const {
    containerLoadEnabled,
    containerNameForClone,
    dockerComposeAvailable,
    ensureContainerEnvDefaults,
    runCloneContainer,
    waitForAgentHealth,
    writeCloneDockerCompose
  } = await import("./core/cloneContainerDeployer.js");

  const baselineAgentDir = process.cwd();
  const packagesRoot = resolve(baselineAgentDir, "../SimulatorAgentPackages");
  const installed = installPackageFromPath({
    sourcePath: command.archivePath,
    packagesRoot
  });
  const installedPackage = loadDomainPackage(installed.packageDir);
  const cloneFolderName = installedPackage.agentCardPartial?.name ?? installed.packageName;
  const iterationLabel = process.env.PACKAGE_LOAD_ITERATION?.trim() || undefined;
  const cloned = cloneAgentForPackage({
    baselineAgentDir,
    packageName: installed.packageName,
    folderName: cloneFolderName,
    iterationLabel
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
  const deployedShapesPath = join(cloned.cloneDir, "validation", "skill_subset_intent_shapes.ttl");
  const cloneEnvUpdates: Array<{ key: string; value: string }> = [
    { key: "DOMAIN_PACKAGE_DIR", value: domainPackageValue },
    { key: "SKILL_FILE", value: skillFileValue },
    { key: "ENABLE_PACKAGE_LOAD", value: "false" }
  ];
  if (existsSync(deployedShapesPath)) {
    cloneEnvUpdates.push({
      key: "SHACL_SHAPES_FILE",
      value: normalizeEnvPath(relative(cloned.cloneDir, deployedShapesPath))
    });
  }
  const cloneEnvPath = join(cloned.cloneDir, ".env");
  updateEnvFile(cloneEnvPath, cloneEnvUpdates);
  applyPackageMappingEnvDefaults(cloneEnvPath, installed.packageDir);
  const iterationMlflowExperiment = resolveE1IterationMlflowExperimentName(iterationLabel);
  const iterationMlflowDescription = resolveE1IterationMlflowDescription();
  if (iterationMlflowExperiment) {
    const mlflowEnvUpdates: Array<{ key: string; value: string }> = [
      { key: "MLFLOW_EXPERIMENT_NAME", value: iterationMlflowExperiment }
    ];
    if (iterationMlflowDescription) {
      mlflowEnvUpdates.push({
        key: "MLFLOW_EXPERIMENT_DESCRIPTION",
        value: iterationMlflowDescription
      });
    }
    updateEnvFile(cloneEnvPath, mlflowEnvUpdates);
    const trackingUriHost =
      process.env.MLFLOW_TRACKING_URI?.trim() || resolveE1IterationMlflowTrackingUriHost();
    if (trackingUriHost) {
      try {
        const experimentId = await resolveMlflowExperimentId({
          trackingUri: trackingUriHost,
          experimentName: iterationMlflowExperiment,
          experimentDescription: iterationMlflowDescription
        });
        process.stdout.write(
          `MLflow experiment: ${iterationMlflowExperiment} (id ${experimentId})\n`
        );
      } catch (error) {
        process.stderr.write(
          `[MLflow] experiment provisioning skipped: ${error instanceof Error ? error.message : String(error)}\n`
        );
      }
    }
  }
  applyPreservedAgentApiKeyFromEnv(cloneEnvPath);
  const agentApiKey = ensureAgentApiKeyForClone(cloneEnvPath);
  const cloneConfig = loadA2AConfigFromDirectory(cloned.cloneDir);
  const clonePackage = loadDomainPackage(cloned.cloneDir);
  const card = buildAgentCard(cloneConfig, clonePackage);
  const syncResults = syncAgentApiKeyToConsumers(baselineAgentDir, card.name, agentApiKey);
  const controllerEnvPath = join(resolve(baselineAgentDir, ".."), "SimulatorController", ".env");
  syncGraphDbCredentialsToClone(controllerEnvPath, cloneEnvPath);
  await prepareAndRegisterA2A(cloneConfig, clonePackage, cloned.cloneDir, "package_load");
  pruneClonePackagingArtifacts(cloned.cloneDir);

  const port = readDotEnvKey(cloneEnvPath, "API_SERVER_PORT") ?? "3011";
  const shouldContainerize = !command.skipContainer && containerLoadEnabled();
  let containerStarted = false;
  if (shouldContainerize) {
    if (!dockerComposeAvailable()) {
      throw new Error(
        "Docker Compose is not available. Install Docker and ensure `docker compose version` works, " +
          "or re-run with --no-container to skip container startup."
      );
    }
    ensureContainerEnvDefaults(cloneEnvPath);
    writeCloneDockerCompose({
      cloneDir: cloned.cloneDir,
      cloneName: cloned.cloneName,
      port
    });
    const containerResult = runCloneContainer(cloned.cloneDir, cloned.cloneName, port);
    if (!containerResult.ok) {
      if (containerResult.stdout.trim()) {
        process.stderr.write(containerResult.stdout);
      }
      if (containerResult.stderr.trim()) {
        process.stderr.write(containerResult.stderr);
      }
      throw new Error(
        `Failed to build/start container for ${cloned.cloneName} (exit ${containerResult.exitCode ?? "unknown"}). ` +
          "Check Docker daemon, port conflicts, and run `docker compose logs` in the clone directory."
      );
    }
    const healthy = await waitForAgentHealth(Number(port));
    if (!healthy) {
      throw new Error(
        `Container ${containerResult.containerName} started but /health on port ${port} did not respond in time. ` +
          `Check logs: cd "${cloned.cloneDir}" && docker compose logs`
      );
    }
    containerStarted = true;
  }

  process.stdout.write(`Package installed: ${installed.packageName}\n`);
  process.stdout.write(`Package directory: ${installed.packageDir}\n`);
  process.stdout.write(`Agent clone: ${cloned.cloneDir}\n`);
  process.stdout.write(`Clone version: ${cloned.version}\n`);
  process.stdout.write(`Cloned package copy: ${cloned.cloneDir}\n`);
  process.stdout.write(`AGENT_API_KEY written to ${cloneEnvPath}\n`);
  for (const result of syncResults) {
    if (result.updated) {
      process.stdout.write(`AGENT_API_KEYS updated in ${result.path}\n`);
    } else if (result.skipped) {
      process.stdout.write(`AGENT_API_KEYS sync skipped for ${result.path}${result.reason ? `: ${result.reason}` : ""}\n`);
    } else {
      process.stdout.write(`AGENT_API_KEYS already current in ${result.path}\n`);
    }
  }
  if (deployedTools.copiedToolFiles.length > 0) {
    process.stdout.write(`Copied package tools: ${deployedTools.copiedToolFiles.join(", ")}\n`);
  }
  if (containerStarted) {
    process.stdout.write(
      `Container started: ${containerNameForClone(cloned.cloneName)} (port ${port})\n`
    );
    process.stdout.write(`Health: http://127.0.0.1:${port}/health\n`);
    process.stdout.write(`Manage: cd "${cloned.cloneDir}" && docker compose logs -f\n`);
    process.stdout.write(
      `Fallback (host): cd "${cloned.cloneDir}" && npx tsx src/index.ts --debug\n`
    );
  } else {
    process.stdout.write(
      `Run with: cd "${cloned.cloneDir}" && npx tsx src/index.ts --debug\n`
    );
  }
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
  const result = await orchestrator.runTurn(session, prompt, {
    replHookDebug: debug,
    replHookDebugLogPath: debugLogPath
  });
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
      const result = await orchestrator.runTurn(session, userText, {
        replHookDebug: debug,
        replHookDebugLogPath: debugLogPath
      });
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
    const pkgDir = orchestrator.getDomainPackage().packageDir;
    await shutdownObservationStreamsIfPresent(pkgDir);
    await shutdownSyntheticRunsIfPresent(pkgDir);
    rl.close();
  }
}

if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const argv = process.argv.slice(2);
  const execution = (async () => {
    const handled = await runPackageLoadCommand(argv);
    if (handled) return;
    const options = parseCliOptions(argv);
    process.env.OBS_LOG_N = String(options.obsLogN);
    if (options.apiServerPort !== undefined) {
      process.env.API_SERVER_PORT = String(options.apiServerPort);
    }
    const orchestrator = createAgentRuntime();
    await bootstrapMlflowTracing(orchestrator);
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
        agentCard: card,
        agentApiKey: config.agentApiKey,
        agentApiKeyHeader: config.agentApiKeyHeader
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
        await shutdownMlflowTracing();
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
