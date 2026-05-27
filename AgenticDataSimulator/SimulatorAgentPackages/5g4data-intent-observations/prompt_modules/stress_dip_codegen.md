Stress-period dip episodes (when instructions mention stress windows, dips, or short downward episodes):

Semantics:
- Dips are **discrete episodes** inside a stress hour window — not a random coin flip on every minute.
- Schedule at least **two non-overlapping dip episodes** per stress window per simulated day.
- Each dip lasts **3–10 minutes** (= 3–10 ticks when `ctx.frequencySeconds` is 60).

Deterministic scheduling:
- Derive a day index from `ctx.tickIndex` and historic bounds (or `Math.floor(ctx.tickIndex * ctx.frequencySeconds / 86400)`).
- Use `ctx.uniformForStep(episodeKey)` where `episodeKey` combines day index, stress window id (0 or 1), and dip index (0 or 1) — e.g. `dayIndex * 1000 + windowId * 100 + dipIndex`.
- Episode start offset within the stress window: `Math.floor(ctx.uniformForStep(key) * (windowMinutes - dipDuration))`.
- Dip duration in ticks: `3 + Math.floor(ctx.uniformForStep(key + 1) * 8)` (3–10 inclusive at 60s frequency).

During a dip episode:
- Return values in the dip band from instructions (e.g. 200–300): `200 + ctx.uniform01() * 100`.

Outside dip episodes:
- Use the gauge baseline for the current hour from the gauge_codegen rules.

Anti-patterns:
- `ctx.uniformForStep(i) < 0.5` on every tick inside a stress hour — produces ~50% random dips, not structured episodes.
- `ctx.tickIndex % 60 === 0` as the only dip trigger — does not yield multiple dips per window or stable episode length.
