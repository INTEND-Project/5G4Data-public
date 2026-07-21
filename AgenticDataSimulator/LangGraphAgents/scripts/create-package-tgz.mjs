#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const sourceArg = process.argv[2];
if (!sourceArg) {
  process.stderr.write("Usage: node scripts/create-package-tgz.mjs <package-dir> [output.tgz]\n");
  process.exit(1);
}

const sourceDir = resolve(process.cwd(), sourceArg);
if (!existsSync(sourceDir)) {
  process.stderr.write(`Package directory not found: ${sourceDir}\n`);
  process.exit(1);
}

const outArg = process.argv[3];
const outputPath = resolve(
  process.cwd(),
  outArg ?? `dist/packages/${basename(sourceDir)}.tgz`
);
mkdirSync(dirname(outputPath), { recursive: true });
execFileSync("tar", ["-czf", outputPath, "-C", sourceDir, "."], { stdio: "pipe" });
process.stdout.write(`Created package archive: ${outputPath}\n`);
