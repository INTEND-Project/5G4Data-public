import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export async function applyOnPackageLoad(args: { cloneDir: string; packageDir: string }): Promise<void> {
  const indexPath = join(args.cloneDir, "src", "index.ts");
  if (!existsSync(indexPath)) return;

  let source = readFileSync(indexPath, "utf8");
  if (source.includes("writeIntentTurtleDebugFile")) return;

  source = source.replace(
    'import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";',
    'import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";'
  );

  source = source.replace(
    '  appendFileSync(absolutePath, `${JSON.stringify(entry)}\\n`, "utf8");',
    `  appendFileSync(absolutePath, \`\${JSON.stringify(entry)}\\n\`, "utf8");
  writeIntentTurtleDebugFile(absolutePath, result.response);`
  );

  source = source.replace(
    "\nasync function runOneShot(",
    `
function extractIntentTurtle(responseText: string): { intentId: string; turtle: string } | null {
  const trimmed = responseText.trim();
  const fenced = trimmed.match(/^\\\`\\\`\\\`(?:turtle|ttl)?\\s*([\\s\\S]*?)\\s*\\\`\\\`\\\`$/i);
  const turtle = (fenced?.[1] ?? trimmed).trim();
  if (!turtle.includes("icm:Intent")) return null;
  const idMatch = turtle.match(/\\bdata5g:(I[a-f0-9]{32}|I[a-f0-9-]{36})\\b/i);
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
  const filePath = join(logsDir, \`\${extracted.intentId}.ttl\`);
  writeFileSync(filePath, \`\${extracted.turtle}\\n\`, "utf8");
}

async function runOneShot(`
  );

  writeFileSync(indexPath, source, "utf8");
}
