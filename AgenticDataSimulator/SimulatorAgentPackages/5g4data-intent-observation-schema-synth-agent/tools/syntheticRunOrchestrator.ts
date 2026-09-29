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
import { looksLikeSyntheticObservationPrompt, parseSyntheticPrompt } from "./syntheticPrompt.js";
import type { ParsedSyntheticPrompt } from "./syntheticPrompt.js";
import {
  nlToConstraintDocument,
  parseConstraintDocument,
  type ConstraintDocument,
} from "./schemaSynth/index.js";

interface SpawnedSynth {
  compoundMetric: string;
  child: ChildProcess;
}

const sessions = new Map<string, SpawnedSynth[]>();

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
  const list = sessions.get(sessionId);
  if (!list || list.length === 0) return "No schema-synth metric workers.";
  const lines = list.map(({ compoundMetric, child }) => `- metric=${compoundMetric}, pid=${child.pid ?? "?"}`);
  return [`Schema-synth workers: ${list.length}`, ...lines].join("\n");
}

export function stopSyntheticObservationForSession(sessionId: string): string {
  const list = sessions.get(sessionId);
  if (!list || list.length === 0) return "No schema-synth workers for this session.";
  let n = 0;
  for (const { child } of list) {
    child.kill("SIGTERM");
    n += 1;
  }
  sessions.delete(sessionId);
  return `Stopped ${n} schema-synth worker process(es).`;
}

export function stopAllSyntheticRuns(): void {
  for (const list of sessions.values()) {
    for (const { child } of list) child.kill("SIGTERM");
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
    const cp = spawn(
      npxCli,
      ["--yes", "tsx", workerAbsTs, cfgPath],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        env: process.env
      }
    );
    cp.unref();

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

  sessions.set(args.sessionId, spawned);

  const tails = spawned.map(({ compoundMetric }) => `\`- ${compoundMetric}\``);
  const modeTail =
    args.parsed.mode === "historic"
      ? `historic window ${args.parsed.historicStart?.toISOString()}→${args.parsed.historicEnd?.toISOString()}`
      : "streaming (wall clock)";

  const logsRoot = join(process.cwd(), "logs");
  return [
    `Started ${spawned.length} schema-synth observation worker process(es); ${modeTail}.`,
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
