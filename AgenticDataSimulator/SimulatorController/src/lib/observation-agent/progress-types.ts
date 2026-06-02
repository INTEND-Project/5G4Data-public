export type ObservationProgressPhase =
  | "codegen"
  | "generating"
  | "flushing"
  | "completed"
  | "failed";

export type MetricProgressPhase =
  | "pending"
  | "codegen"
  | "generating"
  | "flushing"
  | "completed"
  | "failed";

export type MetricProgressEntry = {
  compoundMetric: string;
  phase: MetricProgressPhase;
  ticksDone: number;
  ticksTotal: number | null;
  samplesFlushed?: number;
  workerPid?: number;
};

export type ObservationProgressSnapshot = {
  schemaVersion: "observation_progress_v1";
  updatedAt: string;
  intentId: string;
  sessionId?: string;
  mode: "streaming" | "historic";
  phase: ObservationProgressPhase;
  codegenMetricsDone: number;
  codegenMetricsTotal: number;
  metrics: MetricProgressEntry[];
  aggregate: {
    ticksDone: number;
    ticksTotal: number | null;
    percent: number | null;
  };
};

export type ObservationProgressResponse = {
  status: "idle" | "active";
  progress: ObservationProgressSnapshot | null;
};
