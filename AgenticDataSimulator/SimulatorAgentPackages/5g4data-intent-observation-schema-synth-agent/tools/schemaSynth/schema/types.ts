import { z } from "zod";

export const BandSchema = z
  .object({
    min: z.number(),
    max: z.number()
  })
  .refine((b) => b.max >= b.min, { message: "band.max must be >= band.min" });

export const NoiseLevelSchema = z.enum(["none", "low", "medium", "high"]);

export const TimelineSchema = z
  .object({
    mode: z.enum(["historic", "streaming"]).default("historic"),
    /** Required for historic; optional for streaming (wall-clock). */
    start: z.string().min(1).optional(),
    stop: z.string().min(1).optional(),
    frequencySeconds: z.number().int().positive(),
    timezone: z.string().optional()
  })
  .superRefine((t, ctx) => {
    if (t.mode === "historic") {
      if (!t.start) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "timeline.start required for historic", path: ["start"] });
      }
      if (!t.stop) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "timeline.stop required for historic", path: ["stop"] });
      }
    }
  });

export const MetricSchema = z.object({
  name: z.string().min(1),
  unit: z.string().optional()
});

export const RecurringWindowSchema = z.object({
  startHour: z.number().min(0).max(23),
  endHour: z.number().min(0).max(24),
  band: BandSchema,
  noise: NoiseLevelSchema.optional(),
  dailyVariation: z.boolean().optional()
});

export const EpisodeDurationSchema = z.object({
  min: z.number().positive(),
  max: z.number().positive()
});

export const EpisodeCountSchema = z.object({
  atLeast: z.number().int().positive().default(1)
});

export const EpisodeSchema = z.object({
  type: z.enum(["dip", "spike"]),
  windows: z
    .array(
      z.object({
        startHour: z.number().min(0).max(23),
        endHour: z.number().min(0).max(24)
      })
    )
    .min(1),
  band: BandSchema,
  durationMinutes: EpisodeDurationSchema,
  countPerWindow: EpisodeCountSchema.default({ atLeast: 2 })
});

export const CounterSchema = z.object({
  startAt: z.number(),
  increment: BandSchema
});

export const LevelSchema = z.union([
  z.number(),
  z.object({
    mean: z.number(),
    band: BandSchema.optional()
  })
]);

export const SeasonalitySchema = z.object({
  periodHours: z.number().positive().default(24),
  amplitude: z.number().nonnegative(),
  phaseHours: z.number().optional()
});

export const ResidualSchema = z.object({
  type: z.enum(["white", "ar1"]),
  sigma: z.number().nonnegative(),
  phi: z.number().gt(-1).lt(1).optional()
});

export const ShocksSchema = z.object({
  ratePerDay: z.number().nonnegative(),
  scale: z.number().nonnegative(),
  distribution: z.enum(["gaussian", "student_t"]).default("gaussian"),
  df: z.number().positive().optional()
});

export const AbsoluteOverrideSchema = z.object({
  start: z.string().min(1),
  stop: z.string().min(1),
  band: BandSchema
});

export const ConstraintDocumentSchema = z.object({
  version: z.literal(1).default(1),
  samplingKind: z.enum(["gauge", "counter"]).default("gauge"),
  timeline: TimelineSchema,
  metrics: z.array(MetricSchema).min(1),
  defaultBand: BandSchema.optional(),
  recurringWindows: z.array(RecurringWindowSchema).default([]),
  episodes: z.array(EpisodeSchema).default([]),
  absoluteOverrides: z.array(AbsoluteOverrideSchema).default([]),
  noise: NoiseLevelSchema.default("low"),
  counter: CounterSchema.optional(),
  level: LevelSchema.optional(),
  seasonality: SeasonalitySchema.optional(),
  residual: ResidualSchema.optional(),
  shocks: ShocksSchema.optional(),
  seed: z.union([z.string(), z.number()]).optional()
});

export type Band = z.infer<typeof BandSchema>;
export type ConstraintDocument = z.infer<typeof ConstraintDocumentSchema>;
export type RecurringWindow = z.infer<typeof RecurringWindowSchema>;
export type Episode = z.infer<typeof EpisodeSchema>;

export function parseConstraintDocument(raw: unknown): ConstraintDocument {
  return ConstraintDocumentSchema.parse(raw);
}

export function safeParseConstraintDocument(raw: unknown) {
  return ConstraintDocumentSchema.safeParse(raw);
}
