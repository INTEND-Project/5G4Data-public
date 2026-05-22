import { existsSync, readFileSync } from "node:fs";
import { Parser } from "n3";

export interface ShaclValidationResult {
  conforms: boolean;
  reportText: string;
}

/**
 * Lightweight SHACL gate:
 * - validates Turtle parseability
 * - ensures shapes file exists
 * - leaves full SHACL execution pluggable for OpenClaw deployment environments
 */
export class ShaclValidatorTool {
  constructor(private readonly shapesFile: string) {}

  validateTurtle(turtleText: string): ShaclValidationResult {
    if (!existsSync(this.shapesFile)) {
      return { conforms: false, reportText: `SHACL shapes file not found: ${this.shapesFile}` };
    }
    try {
      const parser = new Parser({ format: "text/turtle" });
      parser.parse(turtleText);
      // Read once so startup fails fast if operator points to unreadable shapes file.
      readFileSync(this.shapesFile, "utf8");
      return { conforms: true, reportText: "Conforms (syntax + shape file availability check)." };
    } catch (error) {
      return { conforms: false, reportText: `SHACL validation execution failed: ${String(error)}` };
    }
  }
}
