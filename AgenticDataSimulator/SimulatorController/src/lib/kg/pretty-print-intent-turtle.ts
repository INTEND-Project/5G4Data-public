import { Parser, Writer, type Quad } from "n3";

/** Preferred Turtle prefixes (aligned with Intent-Simulator graphdb_client). */
const INTENT_TURTLE_PREFIXES: Record<string, string> = {
  data5g: "http://5g4data.eu/5g4data#",
  icm: "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/",
  imo: "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/",
  log: "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/",
  set: "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/",
  quan: "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/",
  dct: "http://purl.org/dc/terms/",
  geo: "http://www.opengis.net/ont/geosparql#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

function serializeQuads(quads: Quad[]): string {
  const writer = new Writer({ format: "text/turtle", prefixes: INTENT_TURTLE_PREFIXES });
  for (const quad of quads) {
    writer.addQuad(quad);
  }

  let result = "";
  writer.end((error, serialized) => {
    if (error) {
      throw error;
    }
    result = serialized;
  });
  return result.trim();
}

/**
 * Parse and re-serialize Turtle for display (Intent-Simulator uses rdflib the same way).
 * Returns the original string when parsing or serialization fails.
 */
export function prettyPrintIntentTurtle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parser = new Parser({ format: "text/turtle" });
    const quads = parser.parse(trimmed);
    if (!Array.isArray(quads) || quads.length === 0) {
      return trimmed;
    }

    const formatted = serializeQuads(quads);
    return formatted.length > 0 ? formatted : trimmed;
  } catch {
    return trimmed;
  }
}
