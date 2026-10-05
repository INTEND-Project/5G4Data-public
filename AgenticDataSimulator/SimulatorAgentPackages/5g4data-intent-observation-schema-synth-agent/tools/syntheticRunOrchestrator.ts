import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { GraphDbTool } from "./graphdbTool.js";
import {
  effectiveGraphDbEnv,
  type GraphDbEnvFallback,
  type GraphTargetBinding
} from "./graphTargetBinding.js";
import { appendObservationError, writeObservationProgramLog } from "./observationLog.js";
import {
  failObservationSetup,
  historicTickCount,
  initObservationProgress,
  markCodegenComplete,
  markCodegenMetric,
  markMetricCompleted,
  markMetricFailed,
} from "./observationProgress.js";
import { ObservationTool } from "./observationTool.js";
import type { ObservationStorageId } from "./observationStorageTypes.js";
import { DEFAULT_OBSERVATION_STORAGE } from "./observationStorageTypes.js";
import { IntentStatusEvaluator, DEFAULT_STATUS_BOOTSTRAP_DELAY_SECONDS } from "./intentStatusEvaluator.js";
import { SampleBus } from "./sampleBus.js";
import { looksLikeSyntheticObservationPrompt, parseSyntheticPrompt } from "./syntheticPrompt.js";
import type { ParsedSyntheticPrompt, SyntheticMode } from "./syntheticPrompt.js";
import {
  nlToConstraintDocument,
  parseConstraintDocument,
  type ConstraintDocument,
} from "./schemaSynth/index.js";

interface SpawnedSynth {
  compoundMetric: string;
  child: ChildProcess;
}

export interface SyntheticStatusSessionSettings {
  observationRetentionWindow?: number;
  intentStatusReportsEnabled?: boolean;
  intentStatusBootstrapCompliantDelay?: number;
}

export interface ResolvedSyntheticStatusSettings {
  statusReportsEnabled: boolean;
  retentionSeconds: number;
  bootstrapCompliantDelaySeconds?: number;
}

const DEFAULT_RETENTION_SECONDS = 300;

export function resolveSyntheticStatusSettings(
  parsed: ParsedSyntheticPrompt,
  session?: SyntheticStatusSessionSettings | null,
): ResolvedSyntheticStatusSettings {
  const statusReportsEnabled =
    parsed.statusReportsEnabled ?? session?.intentStatusReportsEnabled ?? false;
  const retentionSeconds =
    parsed.retentionSeconds ??
    session?.observationRetentionWindow ??
    DEFAULT_RETENTION_SECONDS;
  const bootstrapCompliantDelaySeconds =
    parsed.bootstrapCompliantDelaySeconds ??
    session?.intentStatusBootstrapCompliantDelay ??
    (statusReportsEnabled ? DEFAULT_STATUS_BOOTSTRAP_DELAY_SECONDS : undefined);
  return {
    statusReportsEnabled,
    retentionSeconds,
    ...(bootstrapCompliantDelaySeconds !== undefined
      ? { bootstrapCompliantDelaySeconds }
      : {}),
  };
}

export interface GenerationRun {
  runId: string;
  sessionId: string;
  intentId: string;
  mode: SyntheticMode;
  frequencySeconds: number;
  retentionSeconds: number;
  statusReportsEnabled: boolean;
  sampleBus: SampleBus;
  statusEvaluator?: IntentStatusEvaluator;
  workers: SpawnedSynth[];
}

const sessions = new Map<string, GenerationRun>();

function attachWorkerSampleForwarding(
  child: ChildProcess,
  run: GenerationRun,
  compoundMetric: string,
  conditionId: string,
): void {
  if (!child.stdout) return;
  let buf = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.startsWith("{")) continue;
      try {
        const msg = JSON.parse(line) as {
          type?: string;
          metric?: string;
          timestampMs?: number;
          value?: number;
          conditionId?: string;
        };
        if (msg.type !== "sample") continue;
        const timestampMs = Number(msg.timestampMs);
        const value = Number(msg.value);
        if (!Number.isFinite(timestampMs) || !Number.isFinite(value)) continue;
        const event = {
          metric: (msg.metric ?? compoundMetric).trim(),
          timestampMs,
          value,
          conditionId: msg.conditionId ?? conditionId,
        };
        run.sampleBus.publish(event);
        run.statusEvaluator?.noteSampleTimestamp(timestampMs);
      } catch {
        // non-JSON worker log lines
      }
    }
  });
}

function waitForWorkerStdoutAndExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let exited = child.exitCode !== null;
    let stdoutDone = !child.stdout || child.stdout.readableEnded;
    const tryResolve = () => {
      if (exited && stdoutDone) resolve();
    };
    if (!exited) {
      child.once("exit", () => {
        exited = true;
        tryResolve();
      });
    }
    if (child.stdout && !stdoutDone) {
      child.stdout.once("end", () => {
        stdoutDone = true;
        tryResolve();
      });
      child.stdout.once("close", () => {
        stdoutDone = true;
        tryResolve();
      });
    }
    tryResolve();
  });
}

function stopGenerationRun(run: GenerationRun): void {
  run.statusEvaluator?.stop();
  for (const { child } of run.workers) {
    child.kill("SIGTERM");
  }
  run.sampleBus.clear();
}

function expectedMetricStems(parsed: ParsedSyntheticPrompt): string[] {
  return [
    ...new Set(
      parsed.metricSlices.map((slice) =>
        slice.metricCompound.trim().replace(/^data5g:/iu, "").replace(/`/g, ""),
      ),
    ),
  ];
}

function reportSyntheticSetupFailure(input: {
  intentId: string;
  sessionId: string;
  message: string;
  metric?: string;
  expectedMetrics: readonly string[];
  isHistoric: boolean;
}): void {
  appendObservationError({
    kind: "synthetic_setup_failed",
    message: input.message,
    intentId: input.intentId,
    sessionId: input.sessionId,
    metric: input.metric,
  });
  if (input.isHistoric && input.expectedMetrics.length > 0) {
    failObservationSetup(input.intentId, input.expectedMetrics, input.message);
  }
}

/** Force DSL/prompt globals onto the ConstraintDocument before render. */
export function applyPromptGlobalsToConstraint(
  doc: ConstraintDocument,
  args: {
    mode: "historic" | "streaming";
    frequencySeconds: number;
    metricName: string;
    historicStart?: Date;
    historicEnd?: Date;
    unit?: string;
    seed?: string;
  }
): ConstraintDocument {
  const timeline: ConstraintDocument["timeline"] = {
    ...doc.timeline,
    mode: args.mode,
    frequencySeconds: args.frequencySeconds,
  };
  if (args.mode === "historic") {
    if (args.historicStart) {
      timeline.start = args.historicStart.toISOString().replace(/\.\d{3}Z$/u, "Z");
    }
    if (args.historicEnd) {
      timeline.stop = args.historicEnd.toISOString().replace(/\.\d{3}Z$/u, "Z");
    }
    if (!timeline.start || !timeline.stop) {
      throw new Error("historic mode requires start/stop on the constraint timeline");
    }
  } else {
    // Streaming: keep optional window if present; do not invent a closed historic window.
    if (args.historicStart) {
      timeline.start = args.historicStart.toISOString().replace(/\.\d{3}Z$/u, "Z");
    }
    if (args.historicEnd) {
      timeline.stop = args.historicEnd.toISOString().replace(/\.\d{3}Z$/u, "Z");
    }
  }

  const existing = doc.metrics.find((m) => m.name === args.metricName);
  const metrics = [
    {
      name: args.metricName,
      unit: args.unit ?? existing?.unit ?? doc.metrics[0]?.unit,
    },
  ];

  return parseConstraintDocument({
    ...doc,
    timeline,
    metrics,
    seed: args.seed ?? doc.seed,
  });
}

export function syntheticObservationStatus(sessionId: string): string {
  const run = sessions.get(sessionId);
  if (!run || run.workers.length === 0) return "No schema-synth metric workers.";
  const statusNote = run.statusReportsEnabled ? ", intent status reports=on" : "";
  const lines = run.workers.map(
    ({ compoundMetric, child }) => `- metric=${compoundMetric}, pid=${child.pid ?? "?"}${statusNote}`,
  );
  return [`Schema-synth workers: ${run.workers.length}`, ...lines].join("\n");
}

export function stopSyntheticObservationForSession(sessionId: string): string {
  const run = sessions.get(sessionId);
  if (!run || run.workers.length === 0) return "No schema-synth workers for this session.";
  const n = run.workers.length;
  stopGenerationRun(run);
  sessions.delete(sessionId);
  return `Stopped ${n} schema-synth worker process(es).`;
}

export function stopAllSyntheticRuns(): void {
  for (const run of sessions.values()) {
    stopGenerationRun(run);
  }
  sessions.clear();
}

export async function startSyntheticObservationFromParsed(args: {
  sessionId: string;
  packageDir: string;
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
  graphTargetBinding?: GraphTargetBinding | null;
  parsed: ParsedSyntheticPrompt;
  observationStorageOverride?: ObservationStorageId | null;
  createIntentStorage?: ObservationStorageId | null;
  /** Studio / session LLM override for NL→ConstraintDocument (experiment parity). */
  schemaLlm?: { provider?: "openai" | "anthropic"; model?: string };
  statusSession?: SyntheticStatusSessionSettings | null;
}): Promise<string> {
  const fallback: GraphDbEnvFallback = {
    graphDbEndpoint: args.graphDbEndpoint,
    graphDbNamedGraph: args.graphDbNamedGraph,
    graphDbQueryLimit: args.graphDbQueryLimit
  };
  const graph = GraphDbTool.fromBinding(args.graphTargetBinding, fallback);
  const graphEnv = effectiveGraphDbEnv(args.graphTargetBinding, fallback);
  const intentTurtle = await graph.getIntentTurtle(args.parsed.intentId);
  const isHistoric = args.parsed.mode === "historic";
  const expectedStems = expectedMetricStems(args.parsed);
  if (!intentTurtle) {
    const message = `Intent ${args.parsed.intentId} could not be resolved from GraphDB. Schema-synth run aborted.`;
    reportSyntheticSetupFailure({
      intentId: args.parsed.intentId,
      sessionId: args.sessionId,
      message,
      expectedMetrics: expectedStems,
      isHistoric,
    });
    return message;
  }

  const runRoot = join(process.cwd(), "logs", "schema-synth-runs", args.sessionId.replace(/[^\w.-]+/gu, "_"));
  mkdirSync(runRoot, { recursive: true });

  stopSyntheticObservationForSession(args.sessionId);

  const statusSettings = resolveSyntheticStatusSettings(args.parsed, args.statusSession);
  const statusActive =
    statusSettings.statusReportsEnabled && Boolean(args.parsed.intentId?.trim());

  const run: GenerationRun = {
    runId: `${args.sessionId}-${Date.now()}`,
    sessionId: args.sessionId,
    intentId: args.parsed.intentId,
    mode: args.parsed.mode,
    frequencySeconds: args.parsed.frequencySeconds,
    retentionSeconds: statusSettings.retentionSeconds,
    statusReportsEnabled: statusActive,
    sampleBus: new SampleBus(),
    workers: [],
  };

  if (statusActive) {
    run.statusEvaluator = new IntentStatusEvaluator({
      graph,
      intentId: args.parsed.intentId,
      intentTurtle,
      sampleBus: run.sampleBus,
      mode: args.parsed.mode,
      frequencySeconds: args.parsed.frequencySeconds,
      retentionSeconds: statusSettings.retentionSeconds,
      bootstrapCompliantDelaySeconds: statusSettings.bootstrapCompliantDelaySeconds,
      historicStartMs: args.parsed.historicStart?.getTime(),
      isRunActive: () => sessions.get(args.sessionId)?.runId === run.runId,
    });
    await run.statusEvaluator.start();
  }

  sessions.set(args.sessionId, run);

  const spawned: SpawnedSynth[] = [];
  const workerAbsTs = join(args.packageDir, "tools", "schemaSynthMetricWorker.ts");

  const observationTool = new ObservationTool();
  const streamsByMetric = new Map(
    observationTool.parseReportableObservationStreams(intentTurtle).map((s) => [s.compoundMetric, s])
  );
  const intentMetrics = observationTool.listCompoundMetricsFromIntent(intentTurtle);
  const resolvedMetricNames: string[] = [];
  const ticksTotalPerMetric = new Map<string, number | null>();

  for (const slice of args.parsed.metricSlices) {
    const preResolved = observationTool.resolveCompoundMetricFromIntent(
      slice.metricCompound,
      intentTurtle,
    );
    if (!preResolved) continue;
    resolvedMetricNames.push(preResolved);
    if (
      args.parsed.mode === "historic" &&
      args.parsed.historicStart &&
      args.parsed.historicEnd
    ) {
      ticksTotalPerMetric.set(
        preResolved,
        historicTickCount(
          args.parsed.historicStart,
          args.parsed.historicEnd,
          args.parsed.frequencySeconds,
        ),
      );
    } else {
      ticksTotalPerMetric.set(preResolved, null);
    }
  }

  if (isHistoric) {
    initObservationProgress({
      intentId: args.parsed.intentId,
      sessionId: args.sessionId,
      mode: "historic",
      compoundMetrics: resolvedMetricNames,
      ticksTotalPerMetric,
    });
  }

  let idx = 0;
  let mappingDone = 0;
  for (const slice of args.parsed.metricSlices) {
    const resolvedMetric = observationTool.resolveCompoundMetricFromIntent(slice.metricCompound, intentTurtle);
    if (!resolvedMetric) {
      for (const s of spawned) s.child.kill("SIGTERM");
      run.statusEvaluator?.stop();
      sessions.delete(args.sessionId);
      const message = [
        `Metric ${slice.metricCompound} is not defined in GraphDB intent ${args.parsed.intentId}.`,
        `Use one of: ${intentMetrics.map((m) => `data5g:${m}`).join(", ") || "(none found)"}`,
      ].join(" ");
      reportSyntheticSetupFailure({
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        message,
        metric: slice.metricCompound,
        expectedMetrics: expectedStems,
        isHistoric,
      });
      return message;
    }
    const userMetric = slice.metricCompound.trim().replace(/^data5g:/iu, "").replace(/`/g, "");
    if (resolvedMetric !== userMetric) {
      process.stderr.write(
        `Resolved metric ${slice.metricCompound} -> ${resolvedMetric} from GraphDB intent\n`
      );
    }
    const unitResolved = ObservationTool.lookupUnitForCompound(resolvedMetric, intentTurtle, slice.instructionsText);
    const unit = unitResolved !== "NA" ? unitResolved : "NA";
    const streamInfo = streamsByMetric.get(resolvedMetric);
    const storageTypes = streamInfo?.storageTypes ?? [DEFAULT_OBSERVATION_STORAGE];
    const conditionId =
      streamInfo?.conditionId ??
      ObservationTool.parseMetricCompound(resolvedMetric)?.conditionId ??
      "unknown";

    // Reuse codegen progress phase slots for Controller compatibility ("schema mapping").
    if (isHistoric) {
      markCodegenMetric(args.parsed.intentId, resolvedMetric, mappingDone);
    }

    const instructionsForMap = [
      slice.instructionsText,
      args.parsed.mode === "historic" && args.parsed.historicStart && args.parsed.historicEnd
        ? `\`mode=historic\`, \`start=${formatDslDate(args.parsed.historicStart)}\`, \`stop=${formatDslDate(args.parsed.historicEnd)}\`, \`frequency=${args.parsed.frequencySeconds}s\`, \`metric=${resolvedMetric}\``
        : `\`mode=streaming\`, \`frequency=${args.parsed.frequencySeconds}s\`, \`metric=${resolvedMetric}\``,
    ].join(" ");

    let mapped;
    try {
      mapped = await nlToConstraintDocument(instructionsForMap, {
        allowHeuristic: true,
        provider: args.schemaLlm?.provider,
        model: args.schemaLlm?.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isHistoric) {
        markMetricFailed(args.parsed.intentId, resolvedMetric, message);
      }
      appendObservationError({
        kind: "synthetic_setup_failed",
        message,
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        metric: resolvedMetric,
      });
      for (const s of spawned) s.child.kill("SIGTERM");
      run.statusEvaluator?.stop();
      sessions.delete(args.sessionId);
      return message;
    }

    let constraintDoc: ConstraintDocument;
    try {
      constraintDoc = applyPromptGlobalsToConstraint(mapped.document, {
        mode: args.parsed.mode,
        frequencySeconds: args.parsed.frequencySeconds,
        metricName: resolvedMetric,
        historicStart: args.parsed.historicStart,
        historicEnd: args.parsed.historicEnd,
        unit,
        seed: `${args.parsed.intentId}|${resolvedMetric}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isHistoric) {
        markMetricFailed(args.parsed.intentId, resolvedMetric, message);
      }
      appendObservationError({
        kind: "synthetic_setup_failed",
        message,
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        metric: resolvedMetric,
      });
      for (const s of spawned) s.child.kill("SIGTERM");
      run.statusEvaluator?.stop();
      sessions.delete(args.sessionId);
      return message;
    }

    idx += 1;
    const mdir = join(runRoot, `m${idx}_${resolvedMetric.replace(/[^\w.-]+/gu, "_").slice(0, 160)}`);
    mkdirSync(mdir, { recursive: true });
    const constraintPath = join(mdir, "constraints.json");
    const cfgPath = join(mdir, "worker-config.json");

    const constraintJson = JSON.stringify(constraintDoc, null, 2);
    writeFileSync(constraintPath, constraintJson, "utf8");
    writeObservationProgramLog({
      metric: resolvedMetric,
      program: `// schema-synth source=${mapped.source}\n${constraintJson}`,
      intentId: args.parsed.intentId,
      sessionId: args.sessionId,
      mode: args.parsed.mode,
      frequencySeconds: args.parsed.frequencySeconds
    });
    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          compoundMetric: resolvedMetric,
          unit,
          intentId: args.parsed.intentId,
          mode: args.parsed.mode,
          frequencySeconds: args.parsed.frequencySeconds,
          constraintPath,
          historicStartIso: args.parsed.historicStart?.toISOString(),
          historicEndIso: args.parsed.historicEnd?.toISOString(),
          timezoneHint: args.parsed.timezone,
          graphDbEndpoint: graphEnv.graphDbEndpoint,
          graphDbNamedGraph: graphEnv.graphDbNamedGraph,
          graphDbQueryLimit: graphEnv.graphDbQueryLimit,
          repositoryBaseUrl: graphEnv.repositoryBaseUrl,
          conditionId,
          storageTypes,
          observationStorageOverride: args.observationStorageOverride ?? null,
          createIntentStorage: args.createIntentStorage ?? null,
          sessionId: args.sessionId,
          validateBeforeFlush: true,
          emitStatusSampleEvents: statusActive,
          ticksTotal:
            args.parsed.mode === "historic" &&
            args.parsed.historicStart &&
            args.parsed.historicEnd
              ? historicTickCount(
                  args.parsed.historicStart,
                  args.parsed.historicEnd,
                  args.parsed.frequencySeconds,
                )
              : null
        },
        null,
        2
      ),
      "utf8"
    );

    const npxCli = process.platform === "win32" ? "npx.cmd" : "npx";
    // When status is on, keep the child attached with piped stdout so SampleBus IPC
    // drains reliably; detached+unref races finalize and drops Compliant/Degraded.
    const cp = spawn(
      npxCli,
      ["--yes", "tsx", workerAbsTs, cfgPath],
      {
        cwd: process.cwd(),
        detached: !statusActive,
        stdio: statusActive ? ["ignore", "pipe", "inherit"] : "ignore",
        env: process.env
      }
    );
    if (statusActive) {
      attachWorkerSampleForwarding(cp, run, resolvedMetric, conditionId);
    } else {
      cp.unref();
    }

    cp.on("error", (error) => {
      process.stderr.write(`schema-synth spawn error (${resolvedMetric}): ${String(error)}\n`);
    });

    if (isHistoric) {
      markCodegenComplete(args.parsed.intentId, resolvedMetric, cp.pid ?? undefined);
    }
    mappingDone += 1;

    cp.on("exit", (code, signal) => {
      if (code === 0 || code === null) {
        if (isHistoric) {
          markMetricCompleted(args.parsed.intentId, resolvedMetric);
        }
        return;
      }
      if (isHistoric) {
        markMetricFailed(args.parsed.intentId, resolvedMetric);
      }
      const signalNote = signal ? ` (signal ${signal})` : "";
      appendObservationError({
        kind: "synthetic_worker_exit",
        message: `Schema-synth worker for ${resolvedMetric} exited with code ${code}${signalNote}`,
        metric: resolvedMetric,
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        exitCode: code,
      });
    });

    spawned.push({ compoundMetric: resolvedMetric, child: cp });
  }

  run.workers = spawned;

  if (statusActive && run.statusEvaluator && spawned.length > 0) {
    const historicEndMs = args.parsed.historicEnd?.getTime();
    void Promise.all(
      spawned.map(({ child }) => waitForWorkerStdoutAndExit(child)),
    )
      .then(async () => {
        if (args.parsed.mode === "historic" && historicEndMs !== undefined) {
          await run.statusEvaluator?.finalizeHistoric(historicEndMs);
        }
        run.statusEvaluator?.stop();
      })
      .catch((error) => {
        process.stderr.write(
          `[intent-status] finalize failed intent=${args.parsed.intentId}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        run.statusEvaluator?.stop();
      });
  }

  const tails = spawned.map(({ compoundMetric }) => `\`- ${compoundMetric}\``);
  const modeTail =
    args.parsed.mode === "historic"
      ? `historic window ${args.parsed.historicStart?.toISOString()}→${args.parsed.historicEnd?.toISOString()}`
      : "streaming (wall clock)";

  const logsRoot = join(process.cwd(), "logs");
  const statusTail = statusActive
    ? `Intent status reports enabled (retention=${statusSettings.retentionSeconds}s).`
    : "";

  return [
    `Started ${spawned.length} schema-synth observation worker process(es); ${modeTail}.`,
    ...(statusTail ? [statusTail] : []),
    `Run directory: ${runRoot}`,
    `Constraint logs: ${logsRoot}/observation-program-<metric>.js`,
    "Metrics:",
    ...tails,
    "`observe status` lists stream + schema-synth PIDs.",
    "`observe synthetic stop` stops schema-synth workers.",
    "`observe stop` stops both legacy streams and schema-synth workers."
  ].join("\n");
}

function formatDslDate(d: Date): string {
  const iso = d.toISOString().replace(/\.\d{3}Z$/u, "Z");
  // Prefer ISO; nl mapper accepts both ISO and dd.mm.yyyy
  return iso;
}

export async function handleSyntheticObservationUserLine(opts: {
  line: string;
  sessionId: string;
  packageDir: string;
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
  graphTargetBinding?: GraphTargetBinding | null;
  observationStorageOverride?: ObservationStorageId | null;
  createIntentStorage?: ObservationStorageId | null;
  /** When true, skip `looksLikeSyntheticObservationPrompt` (e.g. `observe synthetic …`). */
  force?: boolean;
  schemaLlm?: { provider?: "openai" | "anthropic"; model?: string };
  statusSession?: SyntheticStatusSessionSettings | null;
}): Promise<{ started: boolean; assistantText?: string }> {
  const trimmed = opts.line.trim();

  if (!opts.force && !looksLikeSyntheticObservationPrompt(trimmed)) {
    return { started: false };
  }

  const parsed = parseSyntheticPrompt(trimmed);
  if (!parsed.ok) return { started: true, assistantText: parsed.error };

  const runArgs = {
    sessionId: opts.sessionId,
    packageDir: opts.packageDir,
    graphDbEndpoint: opts.graphDbEndpoint,
    graphDbNamedGraph: opts.graphDbNamedGraph,
    graphDbQueryLimit: opts.graphDbQueryLimit,
    graphTargetBinding: opts.graphTargetBinding,
    parsed: parsed.value,
    observationStorageOverride: opts.observationStorageOverride,
    createIntentStorage: opts.createIntentStorage,
    schemaLlm: opts.schemaLlm,
    statusSession: opts.statusSession,
  };

  void startSyntheticObservationFromParsed(runArgs)
    .then((detail) => {
      process.stderr.write(
        `[schema-synth-background] session=${opts.sessionId} intent=${parsed.value.intentId}\n${detail}\n`
      );
    })
    .catch((error) => {
      appendObservationError({
        kind: "synthetic_worker_exit",
        message: `Schema-synth observation background run failed: ${error instanceof Error ? error.message : String(error)}`,
        intentId: parsed.value.intentId,
        sessionId: opts.sessionId
      });
    });

  const modeNote =
    parsed.value.mode === "historic" ? "historic replay" : "streaming";
  return {
    started: true,
    assistantText: [
      `Schema-synth observation generation for intent ${parsed.value.intentId} is starting in the background (${modeNote}, ${parsed.value.metricSlices.length} metric(s)).`,
      "NL→ConstraintDocument mapping and worker processes run asynchronously; data will appear in storage as metrics complete.",
      "You can continue this dialogue while generation runs. Use `observe status` to list schema-synth worker PIDs for this session."
    ].join("\n")
  };
}
