/**
 * Overwrite data5g:DataCenter literals with the GraphDB / runtime-grounded
 * nearest edge datacenter. Fixes wrong concrete ids (e.g. EC_1) and placeholders.
 */

function extractGroundedDataCenter(runtimeContext: string): string | null {
  if (!runtimeContext.trim()) return null;
  const candidates = [
    runtimeContext.match(/use exactly\s+`?data5g:DataCenter\s+"([^"]+)"/i)?.[1],
    runtimeContext.match(/\[Deployment locality binding\][\s\S]*?DataCenter\s+"([^"]+)"/i)?.[1],
    runtimeContext.match(/Recommended nearest edge data center:\s*(\S+)/i)?.[1],
    // Plan / narrative forms: resolved ... as `EC_31` / DataCenter "EC_31"
    runtimeContext.match(/resolved from runtime context as\s+`([^`]+)`/i)?.[1],
    runtimeContext.match(/data5g:DataCenter\s+"([^"]+)"/i)?.[1],
    runtimeContext.match(/DataCenter\s+"([^"]+)"/i)?.[1]
  ];
  for (const raw of candidates) {
    const v = (raw ?? "").trim();
    if (!v || v === "<data-center>" || /^<.*>$/.test(v)) continue;
    return v.replace(/\.$/, "");
  }
  return null;
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    runtimeContext?: string;
  };
}): { text: string; changes: number; note?: string } {
  const grounded = extractGroundedDataCenter(args.context.runtimeContext ?? "");
  if (!grounded) return { text: args.text, changes: 0 };

  const hasDe = /data5g:DeploymentExpectation\b/.test(args.text);
  const hasDcLiteral = /data5g:DataCenter\s+"/i.test(args.text);
  if (!hasDe && !hasDcLiteral) return { text: args.text, changes: 0 };

  let changes = 0;
  const text = args.text.replace(/data5g:DataCenter\s+"([^"]*)"/g, (full, current: string) => {
    if (current === grounded) return full;
    changes += 1;
    return `data5g:DataCenter "${grounded}"`;
  });

  if (changes === 0) return { text: args.text, changes: 0 };
  return {
    text,
    changes,
    note: `grounded-datacenter: set DataCenter to runtime ${grounded} (${changes} replacement(s))`
  };
}

export { extractGroundedDataCenter };
