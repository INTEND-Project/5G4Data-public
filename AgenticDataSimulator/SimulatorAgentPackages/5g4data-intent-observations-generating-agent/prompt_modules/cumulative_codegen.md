Cumulative counter codegen (when instructions request cumulative, accumulated, monotonic, or running-total behavior):

Semantics:
- Each sample is the **running total** after steps `0..ctx.tickIndex`, not a per-tick increment or gauge reading.
- At `ctx.tickIndex === 0`, return only the baseline (e.g. start-at value from instructions).
- For `ctx.tickIndex > 0`, sum positive per-step increments for steps `1..ctx.tickIndex`.

Required pattern:
- Parse baseline and per-step increment from the instructions (numbers, units, and `ctx.frequencySeconds` when the instruction ties energy/rate to the sampling interval).
- Use an explicit loop:

```
let total = <baseline>;
for (let i = 1; i <= ctx.tickIndex; i++) {
  total += <positive increment using ctx.uniformForStep(i) for variation>;
}
return total;
```

Use `ctx.uniformForStep(i)` inside the loop so step `i` keeps the same random factor when `ctx.tickIndex` grows. Historic and streaming modes share this API.

Anti-patterns (will fail validation):
- `return baseline + perTickIncrement * ctx.uniform01()` — per-tick gauge, not a running total; values can decrease tick-to-tick.
- `return baseline + ctx.tickIndex * increment * ctx.uniform01()` — `uniform01()` changes every tick, so totals can decrease.
- `return baseline + ctx.tickIndex * increment` when increment varies per tick via `uniform01()`.
- Calling `ctx.uniform01()` inside the accumulation loop — recomputed randomness breaks monotonicity.
- Multiplying the running total each step — can overflow to `Infinity`.

Example (baseline 100, ~360 per step with ±10% variation):

```
let total = 100;
for (let i = 1; i <= ctx.tickIndex; i++) {
  total += 360 * (0.9 + 0.2 * ctx.uniformForStep(i));
}
return total;
```

Adapt baseline, increment magnitude, and variation to match the instruction slice. Values must **never decrease** as `ctx.tickIndex` increases.

When to use (only this module appended — not gauge_codegen):
- Instructions explicitly request cumulative, accumulated, monotonic, running-total, or counter behavior.
- Wording with "start at N then increase", "previous value", or "each tick add".
- Do NOT use this pattern when instructions only specify per-sample value ranges (e.g. "keep values in 500–1000").
