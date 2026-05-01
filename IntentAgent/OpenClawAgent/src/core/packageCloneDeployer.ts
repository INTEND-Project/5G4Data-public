import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DeployPackageToCloneInput {
  packageDir: string;
  cloneDir: string;
  packageName?: string;
}

export interface DeployPackageToCloneResult {
  deployedPackageDir: string;
}

export function deployPackageToClone(input: DeployPackageToCloneInput): DeployPackageToCloneResult {
  const deployedPackageDir = input.cloneDir;
  const copyTargets = [
    "manifest.json",
    "workflow.dsl.json",
    "compatibility.json",
    "checksums.txt",
    "rules",
    "validators",
    "tools",
    "prompts",
    "prompt_modules",
    "skills",
    "dependencies",
    "schemas",
    "validation",
    "examples",
    "tests",
    "mappings"
  ];

  mkdirSync(input.cloneDir, { recursive: true });
  for (const target of copyTargets) {
    const sourcePath = join(input.packageDir, target);
    if (!existsSync(sourcePath)) continue;
    const destinationPath = join(input.cloneDir, target);
    if (existsSync(destinationPath)) {
      rmSync(destinationPath, { recursive: true, force: true });
    }
    cpSync(sourcePath, destinationPath, { recursive: true });
  }

  applyPackageSpecificRuntimePatches(input.packageDir, input.cloneDir);

  return { deployedPackageDir };
}

function applyPackageSpecificRuntimePatches(
  packageDir: string,
  cloneDir: string
): void {
  const shouldPatchNoGraphDbCli = readNoGraphDbCliPatchSetting(packageDir);
  if (!shouldPatchNoGraphDbCli) return;
  const indexPath = join(cloneDir, "src", "index.ts");
  if (!existsSync(indexPath)) return;
  let source = readFileSync(indexPath, "utf8");

  if (!source.includes("noGraphDB")) {
    source = source.replace(
      "interface CliOptions {\n  debug: boolean;\n  debugLogPath: string;\n  prompt: string;\n}",
      `interface CliOptions {
  debug: boolean;
  noGraphDB: boolean;
  debugLogPath: string;
  prompt: string;
}`
    );

    source = source.replace(
      `function parseCliOptions(argv: string[]): CliOptions {
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
}`,
      `function parseCliOptions(argv: string[]): CliOptions {
  let debug = false;
  let noGraphDB = false;
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
    if (token === "--noGraphDB") {
      noGraphDB = true;
      continue;
    }
    promptParts.push(token);
  }
  return { debug, noGraphDB, debugLogPath, prompt: promptParts.join(" ").trim() };
}`
    );

    source = source.replace(
      `    const orchestrator = createAgentRuntime();
    const options = parseCliOptions(argv);`,
      `    const options = parseCliOptions(argv);
    if (options.noGraphDB) {
      process.env.NO_GRAPHDB = "true";
      process.stdout.write("\`--noGraphDB\` mode acknowledged. GraphDB writes will be skipped and payloads printed.\\n");
    }
    const orchestrator = createAgentRuntime();`
    );
  }

  writeFileSync(indexPath, source, "utf8");
}

function readNoGraphDbCliPatchSetting(packageDir: string): boolean {
  const manifestPath = join(packageDir, "manifest.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      runtimePatches?: { cliNoGraphDbFlag?: boolean };
    };
    if (raw.runtimePatches?.cliNoGraphDbFlag === true) return true;
    // Backward compatibility for previously hardcoded observations package behavior.
    return raw.name === "5g4data-intent-observations";
  } catch {
    return packageNameFallback(packageDir);
  }
}

function packageNameFallback(packageDir: string): boolean {
  const marker = "/5g4data-intent-observations";
  return packageDir.includes(marker);
}
