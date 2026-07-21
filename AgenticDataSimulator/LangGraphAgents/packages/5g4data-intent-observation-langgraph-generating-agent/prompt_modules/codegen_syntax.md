Mandatory pre-output syntax check (do this before emitting JSON):

- The harness wraps your snippet as `function (ctx) { <snippet> }`. Output **only** the inner function body — never `function`, never an outer wrapper.
- The body must be valid JavaScript statements and end with `return <number>;` (the sampled magnitude).
- Balance every `(`, `)`, `{`, and `}`. Common model mistakes that fail compilation:
  - Stray `)` before `{` — e.g. `if (cond)) {` or `for (...)) {`
  - Extra `)` after a closed call — e.g. `Math.floor(x))`
  - Empty or malformed argument lists — e.g. `ctx.uniform01())` or `if () {`
  - Minified one-liners without `;` between statements — e.g. `const h = ctx.localHourlet v = 1`
- Use `const` / `let` for locals. When minifying, still terminate each statement with `;`.
- Allowed identifiers: `Math`, `Number`, `Date`, and injected `ctx` only.

Self-check workflow: mentally parse the body as a script inside `function (ctx) { ... }`. If a JS parser would throw `SyntaxError`, fix the snippet and re-check. **Do not respond until the body compiles.**
