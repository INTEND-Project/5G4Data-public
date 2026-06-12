import { existsSync, readFileSync } from "node:fs";
import { Parser, Store } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import {
  validateShaclSparqlConstraints,
  type ShaclViolation
} from "./shaclSparqlConstraints.js";

export type { ShaclViolation };

export interface ShaclValidationResult {
  conforms: boolean;
  reportText: string;
  violations: ShaclViolation[];
}

const SHACL_SPARQL = "http://www.w3.org/ns/shacl#sparql";

function parseTurtle(text: string): Store {
  const parser = new Parser({ format: "text/turtle" });
  const store = new Store();
  for (const quad of parser.parse(text)) {
    store.addQuad(quad);
  }
  return store;
}

function stripSparqlConstraints(store: Store): Store {
  const sparqlNodes = new Set<string>();
  for (const quad of store.getQuads(null, SHACL_SPARQL, null, null)) {
    sparqlNodes.add(quad.object.value);
  }

  const filtered = new Store();
  for (const quad of store.getQuads(null, null, null, null)) {
    if (quad.predicate.value === SHACL_SPARQL) continue;
    if (sparqlNodes.has(quad.subject.value)) continue;
    filtered.addQuad(quad);
  }
  return filtered;
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function termValue(term: { value: string } | undefined): string | undefined {
  return term?.value;
}

function formatCoreViolations(report: {
  results: Array<{
    focusNode: { value: string };
    path: { value: string };
    message: Array<{ value: string }>;
  }>;
}): ShaclViolation[] {
  return report.results.map((result) => ({
    focusNode: termValue(result.focusNode) ? localName(termValue(result.focusNode)!) : undefined,
    path: termValue(result.path) ? localName(termValue(result.path)!) : undefined,
    message: result.message.map((term) => term.value).join(" ") || "SHACL constraint violation."
  }));
}

function formatReportText(violations: ShaclViolation[]): string {
  if (violations.length === 0) {
    return "Conforms.";
  }
  return violations
    .map((violation, index) => {
      const focus = violation.focusNode ? ` focus=${violation.focusNode}` : "";
      const path = violation.path ? ` path=${violation.path}` : "";
      return `${index + 1}. ${violation.message}${focus}${path}`;
    })
    .join("\n");
}

export class ShaclValidatorTool {
  private readonly shapesStore: Store | null;
  private readonly coreShapesStore: Store | null;

  constructor(private readonly shapesFile: string) {
    if (!shapesFile || !existsSync(shapesFile)) {
      this.shapesStore = null;
      this.coreShapesStore = null;
      return;
    }
    const shapesText = readFileSync(shapesFile, "utf8");
    this.shapesStore = parseTurtle(shapesText);
    this.coreShapesStore = stripSparqlConstraints(this.shapesStore);
  }

  async validateTurtle(turtleText: string): Promise<ShaclValidationResult> {
    if (!this.shapesFile) {
      return { conforms: true, reportText: "SHACL validation skipped (no shapes file configured).", violations: [] };
    }
    if (!this.shapesStore || !this.coreShapesStore) {
      return {
        conforms: false,
        reportText: `SHACL shapes file not found: ${this.shapesFile}`,
        violations: [{ message: `SHACL shapes file not found: ${this.shapesFile}` }]
      };
    }

    let dataStore: Store;
    try {
      dataStore = parseTurtle(turtleText);
    } catch (error) {
      const message = `Turtle parse error: ${String(error)}`;
      return {
        conforms: false,
        reportText: message,
        violations: [{ message }]
      };
    }

    const validator = new SHACLValidator(this.coreShapesStore);
    const report = await validator.validate(dataStore);
    const violations = [
      ...formatCoreViolations(report),
      ...validateShaclSparqlConstraints(dataStore)
    ];

    return {
      conforms: violations.length === 0,
      reportText: formatReportText(violations),
      violations
    };
  }
}
