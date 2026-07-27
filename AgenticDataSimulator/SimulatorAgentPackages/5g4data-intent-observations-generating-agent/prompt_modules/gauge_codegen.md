Gauge / per-tick sampling codegen (when instructions describe instantaneous readings in numeric bands):

Semantics:
- Each invocation returns the **current sample only** for this tick — not a running total and not a sum over past ticks.
- Do **not** loop `for (let i = 0; i <= ctx.tickIndex; i++)` to accumulate history. Historic replay already advances `ctx.simTime` and `ctx.tickIndex` per sample.

Time-of-day:
- Use `ctx.localHour` for the **current** tick when instructions mention daytime, business hours, or clock windows (e.g. 06:00–18:00).
- Never derive hour as `(ctx.localHour + Math.floor(i * ctx.frequencySeconds / 3600))` inside a history loop.

Ranges:
- Map instruction bands directly: `low + ctx.uniform01() * (high - low)`.
- Apply the band matching the current hour window (e.g. default/off-hours 700–1500, daytime 500–1000).
- Add small variation with `ctx.uniform01()`; avoid constant output when a range is requested.

Historic mode:
- `ctx.tickIndex` is a sequence index only. Return one reading for the current tick; do not re-simulate the full timeline in a loop.

Required pattern (adapt numbers from instructions):

```
const hour = ctx.localHour;
let value = 700 + ctx.uniform01() * 800;
if (hour >= 6 && hour < 18) {
  value = 500 + ctx.uniform01() * 500;
}
return value;
```

Anti-patterns (will fail validation):
- `for (let i = 0; i <= ctx.tickIndex; i++) { total += increment; }` — running total, not a gauge.
- `value += increment` inside a tickIndex loop.
- Returning a sum when instructions only specify per-sample value ranges.
