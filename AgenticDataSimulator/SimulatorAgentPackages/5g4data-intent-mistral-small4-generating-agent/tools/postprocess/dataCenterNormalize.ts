import { parseDataCenterFromGraphDb } from "../fragmentContextParse.js";

/** Rewrite deployment Context data5g:DataCenter to authoritative GraphDB clusterId from runtime context. */
export function applyPostprocessor(args: {
  text: string;
  context: { runtimeContext?: string };
}): { text: string; changes: number; note?: string } {
  const clusterId = parseDataCenterFromGraphDb(args.context.runtimeContext ?? "");
  if (!clusterId || !/^EC_\d+$/i.test(clusterId)) {
    return { text: args.text, changes: 0 };
  }
  const pattern = /(data5g:DataCenter\s+)"([^"]+)"/g;
  let changes = 0;
  const text = args.text.replace(pattern, (match, prefix: string, value: string) => {
    if (value === clusterId) return match;
    changes += 1;
    return `${prefix}"${clusterId}"`;
  });
  if (changes === 0) return { text: args.text, changes: 0 };
  return {
    text,
    changes,
    note: `dataCenterNormalize: set data5g:DataCenter to ${clusterId}`
  };
}
