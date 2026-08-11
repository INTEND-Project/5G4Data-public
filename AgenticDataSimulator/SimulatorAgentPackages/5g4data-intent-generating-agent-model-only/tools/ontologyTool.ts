import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class OntologyTool {
  constructor(
    private readonly ontologyRoot?: string,
    private readonly exampleIntentsRoot?: string
  ) {}

  ontologySummary(lineLimit = 160): string {
    if (!this.ontologyRoot || !existsSync(this.ontologyRoot)) {
      return "Ontology root is not configured or does not exist.";
    }
    const entrypoint = join(this.ontologyRoot, "IntentCommonModel.ttl");
    if (!existsSync(entrypoint)) return `Ontology entrypoint not found: ${entrypoint}`;
    const lines = readFileSync(entrypoint, "utf8").split(/\r?\n/);
    return `Ontology entrypoint: ${entrypoint}\n${lines.slice(0, lineLimit).join("\n").trim()}`;
  }

  exampleSummary(fileLimit = 5, lineLimit = 60): string {
    if (!this.exampleIntentsRoot || !existsSync(this.exampleIntentsRoot)) {
      return "Example intents root is not configured or does not exist.";
    }
    const turtleFiles = readdirSync(this.exampleIntentsRoot)
      .filter((name) => name.endsWith(".ttl"))
      .sort()
      .slice(0, fileLimit);
    if (turtleFiles.length === 0) {
      return `No Turtle example intents found in ${this.exampleIntentsRoot}`;
    }
    const parts: string[] = [];
    for (const fileName of turtleFiles) {
      const path = join(this.exampleIntentsRoot, fileName);
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      parts.push(`Example file: ${fileName}\n${lines.slice(0, lineLimit).join("\n").trim()}`);
    }
    return parts.join("\n\n");
  }
}
