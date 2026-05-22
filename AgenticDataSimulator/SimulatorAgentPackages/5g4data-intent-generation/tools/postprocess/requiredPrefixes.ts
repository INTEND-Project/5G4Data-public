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

  if (/\bset:/.test(text) && !/@prefix\s+set\s*:/m.test(text)) {
    toInject.push("@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .");
  }
  if (/\bgeo:/.test(text) && !/@prefix\s+geo\s*:/m.test(text)) {
    toInject.push("@prefix geo: <http://www.opengis.net/ont/geosparql#> .");
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
