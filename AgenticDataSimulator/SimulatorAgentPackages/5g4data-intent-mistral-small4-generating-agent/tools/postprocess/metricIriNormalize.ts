/**
 * Safety-net rewrites for Cell O / dual-SHACL:
 * - quan:larger|quan:greater → quan:atLeast
 * - rtt_* / RTT_* → latency_*
 * - bare network throughput_* (not throughput-target) → bandwidth_*
 */
export function applyPostprocessor(args: { text: string }): {
  text: string;
  changes: number;
  note?: string;
} {
  let text = args.text;
  let changes = 0;
  const notes: string[] = [];

  const floors = (text.match(/\bquan:(?:larger|greater)\b/gi) || []).length;
  if (floors > 0) {
    text = text.replace(/\bquan:(?:larger|greater)\b/gi, "quan:atLeast");
    changes += floors;
    notes.push(`quan:larger|greater→atLeast×${floors}`);
  }

  const rtt = (text.match(/\bdata5g:rtt_/gi) || []).length;
  if (rtt > 0) {
    text = text.replace(/\bdata5g:rtt_/gi, "data5g:latency_");
    changes += rtt;
    notes.push(`rtt_→latency_×${rtt}`);
  }

  // throughput_* locals that are not deployment throughput-target
  const thrRe = /\bdata5g:throughput_(?!target\b)([A-Za-z0-9_]+)/gi;
  const thrMatches = [...text.matchAll(thrRe)];
  if (thrMatches.length > 0) {
    text = text.replace(thrRe, "data5g:bandwidth_$1");
    changes += thrMatches.length;
    notes.push(`throughput_→bandwidth_×${thrMatches.length}`);
  }

  // networklatency_ synonym
  const nl = (text.match(/\bdata5g:networklatency_/gi) || []).length;
  if (nl > 0) {
    text = text.replace(/\bdata5g:networklatency_/gi, "data5g:latency_");
    changes += nl;
    notes.push(`networklatency_→latency_×${nl}`);
  }

  return {
    text,
    changes,
    note: notes.length > 0 ? notes.join(", ") : undefined
  };
}
