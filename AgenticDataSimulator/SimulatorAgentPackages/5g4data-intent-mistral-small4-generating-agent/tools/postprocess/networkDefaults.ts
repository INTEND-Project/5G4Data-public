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

  const valueMatch = text.match(/rdf:value\s+([^;\]\n]+)/i);
  if (!valueMatch || needsDefaultThreshold(valueMatch[1])) {
    if (valueMatch) {
      text = text.replace(/rdf:value\s+[^;\]\n]+/i, `rdf:value ${defaults.value}`);
    } else if (/quan:(?:larger|smaller|inRange)\s*\[/.test(text)) {
      text = text.replace(
        /(quan:(?:larger|smaller|inRange)\s*\[\s*quan:unit\s+"[^"]*"\s*;?)(\s*)/i,
        `$1 rdf:value ${defaults.value} ;$2`
      );
    } else {
      text = text.replace(
        /(set:forAll\s*\[[^\]]*?)(])/is,
        `$1 ${defaults.quantifier} [ quan:unit "${defaults.unit}" ; rdf:value ${defaults.value} ] $2`
      );
    }
    changes += 1;
  }

  if (!/quan:unit\s+"[^"]*"/i.test(text)) {
    text = text.replace(
      /(quan:(?:larger|smaller|inRange)\s*\[)/i,
      `$1 quan:unit "${defaults.unit}" ; `
    );
    changes += 1;
  }

  if (!/quan:(?:larger|smaller)/i.test(text)) {
    text = text.replace(
      /(icm:valuesOfTargetProperty\s+data5g:(?:bandwidth|latency)_[^;\]]+;\s*)/i,
      `$1${defaults.quantifier} [ quan:unit "${defaults.unit}" ; rdf:value ${defaults.value} ] `
    );
    changes += 1;
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

  const conditionBlocks = [...text.matchAll(/\bdata5g:(CO[A-Za-z0-9_]+)\s+a[\s\S]*?\./gi)];
  for (const match of conditionBlocks) {
    const block = match[0];
    if (!/data5g:(?:bandwidth|latency|networklatency)_/i.test(block)) continue;

    let patched = block;
    if (/data5g:bandwidth_/i.test(block)) {
      const result = patchMetricBlock(block, /data5g:bandwidth_/i, {
        value: String(DEFAULT_NETWORK_BANDWIDTH_MBPS),
        unit: "mbit/s",
        quantifier: "quan:larger"
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
