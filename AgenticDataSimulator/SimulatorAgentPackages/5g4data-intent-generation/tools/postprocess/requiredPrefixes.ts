/**
 * Ensures common TM Forum / 5G4Data Turtle prefixes are declared when used in the body.
 * LLMs sometimes omit `set:` while still emitting `set:forAll`, which breaks SHACL/RDF parsing.
 */
export function applyPostprocessor(args: {
  text: string;
  context: Record<string, unknown>;
}): { text: string; changes: number; note?: string } {
  let text = args.text;
  const toInject: string[] = [];

  if (/\bdct:/.test(text) && !/@prefix\s+dct\s*:/m.test(text)) {
    toInject.push("@prefix dct: <http://purl.org/dc/terms/> .");
  }
  if (/\blog:/.test(text) && !/@prefix\s+log\s*:/m.test(text)) {
    toInject.push("@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .");
  }
  if (/\bset:/.test(text) && !/@prefix\s+set\s*:/m.test(text)) {
    toInject.push("@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .");
  }
  if (/\bquan:/.test(text) && !/@prefix\s+quan\s*:/m.test(text)) {
    toInject.push("@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .");
  }
  if (/\brdf:/.test(text) && !/@prefix\s+rdf\s*:/m.test(text)) {
    toInject.push("@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .");
  }
  if (/\brdfs:/.test(text) && !/@prefix\s+rdfs\s*:/m.test(text)) {
    toInject.push("@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .");
  }
  if (/\bgeo:/.test(text) && !/@prefix\s+geo\s*:/m.test(text)) {
    toInject.push("@prefix geo: <http://www.opengis.net/ont/geosparql#> .");
  }
  if (
    (/\bfun:/.test(text) || /FunctionOntology\//.test(text)) &&
    !/@prefix\s+fun\s*:/m.test(text)
  ) {
    toInject.push("@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .");
  }
  if (
    (/\bmf:/.test(text) || /MathFunctions\//.test(text)) &&
    !/@prefix\s+mf\s*:/m.test(text)
  ) {
    toInject.push("@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .");
  }
  if (/\but:/.test(text) && !/@prefix\s+ut\s*:/m.test(text)) {
    toInject.push("@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .");
  }
  if (
    (/\btime:/.test(text) || /TimeOntology\//.test(text)) &&
    !/@prefix\s+time\s*:/m.test(text)
  ) {
    toInject.push("@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .");
  }
  if (/\bxsd:/.test(text) && !/@prefix\s+xsd\s*:/m.test(text)) {
    toInject.push("@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .");
  }

  if (toInject.length === 0) {
    return { text, changes: 0 };
  }

  const lines = text.split("\n");
  let insertAt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i]?.trim() ?? "";
    if (t.startsWith("@prefix")) insertAt = i + 1;
    else if (t === "") continue;
    else break;
  }
  lines.splice(insertAt, 0, ...toInject);
  text = lines.join("\n");

  return {
    text,
    changes: toInject.length,
    note: "injected missing Turtle @prefix declarations"
  };
}
