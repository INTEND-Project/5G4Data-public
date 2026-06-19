#!/usr/bin/env npx tsx
/**
 * Validate Turtle intent text against SHACL shapes (kernel ShaclValidatorTool).
 *
 * Usage:
 *   npx tsx scripts/validate-intent-shacl.mts <shapes-file> < turtle.txt
 *   echo '@prefix ...' | npx tsx scripts/validate-intent-shacl.mts path/to/shapes.ttl
 *
 * Prints JSON: { conforms, reportText, violations, violation_count }
 */
import { readFileSync } from "node:fs";
import { ShaclValidatorTool } from "../SimulatorAgentKernel/src/core/shaclValidatorTool.js";

const shapesFile = process.argv[2];
if (!shapesFile) {
  process.stderr.write("Usage: validate-intent-shacl.mts <shapes-file>\n");
  process.exit(2);
}

const turtle = readFileSync(0, "utf8");
const validator = new ShaclValidatorTool(shapesFile);
const result = await validator.validateTurtle(turtle);

const payload = {
  conforms: result.conforms,
  reportText: result.reportText,
  violations: result.violations,
  violation_count: result.violations.length
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
process.exit(result.conforms ? 0 : 1);
