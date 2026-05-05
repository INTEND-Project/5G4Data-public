import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function applyOnPackageLoad(args: { cloneDir: string; packageDir: string }): Promise<void> {
  const indexPath = join(args.cloneDir, "src", "index.ts");
  if (!existsSync(indexPath)) return;

  let source = readFileSync(indexPath, "utf8");
  if (source.includes("noGraphDB")) return;

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
    `    const options = parseCliOptions(argv);
    const orchestrator = createAgentRuntime();`,
    `    const options = parseCliOptions(argv);
    if (options.noGraphDB) {
      process.env.NO_GRAPHDB = "true";
      process.stdout.write("\`--noGraphDB\` mode acknowledged. GraphDB writes will be skipped and payloads printed.\\n");
    }
    const orchestrator = createAgentRuntime();`
  );

  writeFileSync(indexPath, source, "utf8");
}
