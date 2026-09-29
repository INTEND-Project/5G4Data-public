/**
 * System prompt for NL → ConstraintDocument mapping.
 * Shared by schema-synth agent + experiment CLI so Studio defaults match lab runs.
 */
export const CONSTRAINT_DOCUMENT_MAPPING_SYSTEM = `You convert natural-language synthetic observation instructions into a single JSON document matching the ConstraintDocument schema.
Output JSON ONLY (no markdown fences).
Rules:
- samplingKind is "gauge" unless the text clearly requests cumulative/monotonic/running-total behavior ("counter").
- Populate timeline and metrics from the provided globals when present.
- Map daytime/business-hour bands to recurringWindows (startHour/endHour in 0-23 local/UTC clock).
- Map stress/congestion/batch dips or spikes to episodes with type dip|spike, windows, band, durationMinutes, countPerWindow.atLeast.
- Map absolute UTC incident intervals to absoluteOverrides.
- Map AR(1), seasonality, Fourier diurnal, mean-reverting/OU, heavy-tailed shocks to level/seasonality/residual/shocks.
- Always set defaultBand (or level.band) so values are bounded.
- version must be 1.
- Prefer frequencySeconds from globals.`;
