Stress-period dip episodes (when instructions mention stress windows, dips, or short downward episodes):

Semantics:
- Dips are **discrete episodes** inside a stress hour window — not a random coin flip on every tick.
- Schedule at least **two non-overlapping dip episodes** per stress window per simulated day.
- Each dip lasts **3–10 minutes** (= `3 + floor(ctx.uniformForStep(key+1)*8)` ticks at the current `ctx.frequencySeconds`).

Reference scheduling pattern (use `ctx.tickInHour`, never global `ctx.tickIndex` for window offsets):

```js
const hour = ctx.localHour;
let value = /* baseline from gauge_codegen for this hour */;

const isStress = (hour >= 8 && hour < 9) || (hour >= 16 && hour < 17);
if (isStress) {
  const windowId = hour >= 8 && hour < 9 ? 0 : 1;
  const ticksPerHour = Math.ceil(3600 / ctx.frequencySeconds);
  for (let dipIndex = 0; dipIndex < 2; dipIndex += 1) {
    const key = ctx.tickInDay * 1000 + windowId * 100 + dipIndex;
    const dipDuration = 3 + Math.floor(ctx.uniformForStep(key + 1) * 8);
    const maxStart = ticksPerHour - dipDuration;
    const dipStart = Math.floor(ctx.uniformForStep(key) * Math.max(1, maxStart));
    if (ctx.tickInHour >= dipStart && ctx.tickInHour < dipStart + dipDuration) {
      value = 200 + ctx.uniform01() * 100; // dip band from instructions
      break;
    }
  }
}
return value;
```

Deterministic scheduling rules:
- Derive `ctx.tickInDay` and `ctx.tickInHour` from the harness — do not reimplement with raw `ctx.tickIndex` offsets inside the stress hour.
- Use `ctx.uniformForStep(episodeKey)` where `episodeKey` combines `ctx.tickInDay`, stress `windowId` (0 or 1), and `dipIndex` (0 or 1).
- Episode start offset is a **slot within the stress hour** (`ctx.tickInHour`), not a global tick index.

During a dip episode:
- Return values in the dip band from instructions (e.g. 200–300): `200 + ctx.uniform01() * 100`.

Outside dip episodes:
- Use the gauge baseline for the current hour from the gauge_codegen rules.

Anti-patterns (will fail validation):
- Comparing **global** `ctx.tickIndex` to a 0–59 window offset — dips never fire after day 0.
- `ctx.uniformForStep(i) < 0.5` on every tick inside a stress hour — random noise, not structured episodes.
- `ctx.tickIndex % 60 < 10` as the only dip trigger — wrong period at non-60s frequencies; skips most days.
- `hour === 8 && ctx.tickIndex % 60 < 10` — same bug; use `ctx.tickInHour` instead.
