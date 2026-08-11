/** Fallback network thresholds when the catalogue has no network objectives. */
export const DEFAULT_NETWORK_BANDWIDTH_MBPS = 300;
export const DEFAULT_NETWORK_LATENCY_MS = 50;

function needsDefaultThreshold(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const numeric = Number.parseFloat(trimmed.replace(/"|\^\^.*$/g, ""));
  return !Number.isFinite(numeric) || numeric <= 0;
}

function patchMetricBlock(
  block: string,
  stemPattern: RegExp,
  defaults: { value: string; unit: string; quantifier: string }
): { text: string; changes: number } {
  if (!stemPattern.test(block)) return { text: block, changes: 0 };
  let changes = 0;
  let text = block;

  const valueMatch = text.match(/rdf:value\s+"?(-?\d+(?:\.\d+)?)"?(?:\^\^xsd:decimal)?/i);
  if (!valueMatch || needsDefaultThreshold(valueMatch[1])) {
    if (valueMatch) {
      text = text.replace(
        /rdf:value\s+"?-?\d+(?:\.\d+)?"?(?:\^\^xsd:decimal)?/i,
        `rdf:value "${defaults.value}"^^xsd:decimal`
      );
    } else if (/quan:unit\s+"[^"]*"/i.test(text)) {
      text = text.replace(
        /(quan:unit\s+"[^"]*"\s*;?)/i,
        `$1 rdf:value "${defaults.value}"^^xsd:decimal ;`
      );
    } else {
      text = text.replace(
        /(\[\s*)(quan:(?:atLeast|atMost|smaller|larger|greater|inRange)\b)/i,
        `$1$2 [ quan:unit "${defaults.unit}" ; rdf:value "${defaults.value}"^^xsd:decimal ] `
      );
    }
    changes += 1;
  }

  if (!/quan:unit\s+"[^"]*"/i.test(text)) {
    text = text.replace(
      /(a\s+quan:Quantity\s*;)/i,
      `$1 quan:unit "${defaults.unit}" ; `
    );
    changes += 1;
  }

  // Prefer TIO floor names; migrate leftover quan:larger|quan:greater
  if (/quan:(?:larger|greater)\b/i.test(text)) {
    text = text.replace(/quan:(?:larger|greater)\b/gi, "quan:atLeast");
    changes += 1;
  }
  if (
    !/quan:(?:atLeast|atMost|smaller|larger|greater)\b/i.test(text) &&
    /set:forAll/i.test(text)
  ) {
    // last resort: leave block; emitter should have written quantifier
    changes += 0;
  }

  return { text, changes };
}

export function applyPostprocessor(args: { text: string }): {
  text: string;
  changes: number;
  note?: string;
} {
  if (!/data5g:NetworkExpectation/i.test(args.text)) {
    return { text: args.text, changes: 0 };
  }

  let text = args.text;
  let changes = 0;
  const notes: string[] = [];

  // Terminate on statement-final "." (not decimal points like rdf:value 0.0).
  const conditionBlocks = [
    ...text.matchAll(/\bdata5g:(CO[A-Za-z0-9_]+)\s+a[\s\S]*?\.(?=\s*(?:\n|$))/gi)
  ];
  for (const match of conditionBlocks) {
    const block = match[0];
    if (!/data5g:(?:bandwidth|latency|networklatency)_/i.test(block)) continue;

    let patched = block;
    if (/data5g:bandwidth_/i.test(block)) {
      const result = patchMetricBlock(block, /data5g:bandwidth_/i, {
        value: String(DEFAULT_NETWORK_BANDWIDTH_MBPS),
        unit: "mbit/s",
        quantifier: "quan:atLeast"
      });
      patched = result.text;
      changes += result.changes;
    }
    if (/data5g:latency_/i.test(block) || /data5g:networklatency_/i.test(block)) {
      const result = patchMetricBlock(patched, /data5g:(?:latency|networklatency)_/i, {
        value: String(DEFAULT_NETWORK_LATENCY_MS),
        unit: "ms",
        quantifier: "quan:smaller"
      });
      patched = result.text;
      changes += result.changes;
    }

    if (patched !== block) {
      text = text.replace(block, patched);
      notes.push(`network-defaults:${match[1]}`);
    }
  }

  return {
    text,
    changes,
    note: notes.length > 0 ? notes.join(", ") : undefined
  };
}
