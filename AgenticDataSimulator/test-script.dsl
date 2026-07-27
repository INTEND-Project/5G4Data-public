# Find the intent generating agent for this domain
discover intent-agent by domain telenor.5g4data as intentGen

# Create the intent (observation reports → Prometheus in generated Turtle)
create intent using intentGen storage prometheus prompt "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner" as llmIntent

# When the intent is created, extract all the metrics from the Conditions
extract metric-catalog for llmIntent as llmMetrics

# Discover the observation report generating agent for this domain
discover observation-agent by domain telenor.5g4data as observationControl

# Historic run by llmIntent (explicit storage override for this session)
request observation-report using observationControl for llmIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=p99-token-target`, default range is between 700-1500, between 06:00 and 18:00 keep values in the 500-1000 range with daily variation and low noise. During stress periodes between 08:00-09:00 and 16:00-17:00 create dips down to between 200-300 for periods lasting between 3-10 minutes, at least two dips per stress periode" as llmObservationSession

request observation-report using observationControl for llmIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=60s`. For `metric=container-cpu-watts`, default range is between 100-300, between 06:00 and 18:00 gradualy increase values to be in the 500-1000 range with daily variation and low noise. During stress periodes between 08:00-09:00 and 16:00-17:00 create spikes up to between 600-800 for periods lasting between 3-10 minutes, at least two dips per stress periode" as llmObservationSession

request observation-report using observationControl for llmIntent storage prometheus instructions "`mode=historic`, `start=21.05.2026 05:00:00`, `stop=22.05.2026 05:00:00`, `frequency=360s`. `metric=container-cpu-joules-total` Monotonically increasing cumulative counter. Start at 100 on tick 0. On each subsequent tick add increment = 360 * f joules where f = 0.9 + 0.2 * ctx.uniformForStep(i) in [0.9, 1.1] (324-396 joules per step). Each emitted value is the running total after summing steps 0..ctx.tickIndex. Use an explicit loop for (let i = 1; i <= ctx.tickIndex; i++). Do not use ctx.uniform01() inside the accumulation loop. Values must never decrease; always return a finite number." as llmObservationSession