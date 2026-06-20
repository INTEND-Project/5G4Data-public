const FORBIDDEN = [
  /\brequire\s*\(/u,
  /\bimport\b/u,
  /\bprocess\b/u,
  /\bglobalThis\b/u,
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bFunction\s*\(/u,
  /\beval\b/u,
  /\bfs\b/u,
  /\bchild_process\b/u,
  /\.writeFile\b/u,
  /\.readFile\b/u
];

/** Reject snippets that obviously reach for IO or globals beyond `ctx`. */
export function validateGeneratedSnippet(snippet: string): { ok: true } | { ok: false; reason: string } {
  const t = snippet.trim();
  if (!t) return { ok: false, reason: "Empty snippet from model." };
  for (const re of FORBIDDEN) {
    if (re.test(t)) return { ok: false, reason: `Snippet rejected (forbidden construct matching ${String(re)})` };
  }
  return { ok: true };
}
