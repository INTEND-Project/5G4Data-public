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
import { codegenMetricSnippet, instructionsIncludeExplicitNumericRange } from "./syntheticLlmCodegen.js";
import { validateGeneratedSnippet } from "./syntheticSnippetValidate.js";
import { validateSnippetSamples } from "./syntheticSnippetProbe.js";

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

export function syntheticObservationStatus(sessionId: string): string {
  const list = sessions.get(sessionId);
  if (!list || list.length === 0) return "No synthetic metric workers.";
  const lines = list.map(({ compoundMetric, child }) => `- metric=${compoundMetric}, pid=${child.pid ?? "?"}`);
  return [`Synthetic workers: ${list.length}`, ...lines].join("\n");
}

export function stopSyntheticObservationForSession(sessionId: string): string {
  const list = sessions.get(sessionId);
  if (!list || list.length === 0) return "No synthetic workers for this session.";
  let n = 0;
  for (const { child } of list) {
    child.kill("SIGTERM");
    n += 1;
  }
  sessions.delete(sessionId);
  return `Stopped ${n} synthetic worker process(es).`;
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
    const message = `Intent ${args.parsed.intentId} could not be resolved from GraphDB. Synthetic run aborted.`;
    reportSyntheticSetupFailure({
      intentId: args.parsed.intentId,
      sessionId: args.sessionId,
      message,
      expectedMetrics: expectedStems,
      isHistoric,
    });
    return message;
  }

  const runRoot = join(process.cwd(), "logs", "synthetic-runs", args.sessionId.replace(/[^\w.-]+/gu, "_"));
  mkdirSync(runRoot, { recursive: true });

  stopSyntheticObservationForSession(args.sessionId);

  const spawned: SpawnedSynth[] = [];
  const workerAbsTs = join(args.packageDir, "tools", "syntheticMetricWorker.ts");

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
  let codegenDone = 0;
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

    if (isHistoric) {
      markCodegenMetric(args.parsed.intentId, resolvedMetric, codegenDone);
    }

    const codegenSlice = await codegenMetricSnippet({
      fullUserPrompt: args.parsed.rawUserLine,
      intentId: args.parsed.intentId,
      compoundMetric: resolvedMetric,
      kgUnitResolved: unit,
      instructionsSlice: slice.instructionsText,
      mode: args.parsed.mode,
      frequencySeconds: args.parsed.frequencySeconds,
      historicBounds:
        args.parsed.mode === "historic" && args.parsed.historicStart && args.parsed.historicEnd
          ? {
              startIso: args.parsed.historicStart.toISOString(),
              endIso: args.parsed.historicEnd.toISOString()
            }
          : undefined,
      timezoneHint: args.parsed.timezone,
      baselineMin: instructionsIncludeExplicitNumericRange(slice.instructionsText)
        ? undefined
        : streamInfo?.minValue,
      baselineMax: instructionsIncludeExplicitNumericRange(slice.instructionsText)
        ? undefined
        : streamInfo?.maxValue
    });

    if (!codegenSlice.ok) {
      if (isHistoric) {
        markMetricFailed(args.parsed.intentId, resolvedMetric, codegenSlice.error);
      }
      appendObservationError({
        kind: "synthetic_setup_failed",
        message: codegenSlice.error,
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        metric: resolvedMetric,
      });
      for (const s of spawned) s.child.kill("SIGTERM");
      sessions.delete(args.sessionId);
      return codegenSlice.error;
    }

    const v = validateGeneratedSnippet(codegenSlice.snippet);
    if (!v.ok) {
      if (isHistoric) {
        markMetricFailed(args.parsed.intentId, resolvedMetric, v.reason);
      }
      appendObservationError({
        kind: "synthetic_setup_failed",
        message: v.reason,
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        metric: resolvedMetric,
      });
      for (const s of spawned) s.child.kill("SIGTERM");
      sessions.delete(args.sessionId);
      return v.reason;
    }

    const sampleCheck = validateSnippetSamples({
      snippet: codegenSlice.snippet,
      intentId: args.parsed.intentId,
      compoundMetric: resolvedMetric,
      mode: args.parsed.mode,
      frequencySeconds: args.parsed.frequencySeconds,
      historicStartIso: args.parsed.historicStart?.toISOString(),
      historicEndIso: args.parsed.historicEnd?.toISOString(),
      timezoneHint: args.parsed.timezone,
      unitHint: unit,
      instructionsSlice: slice.instructionsText
    });
    if (!sampleCheck.ok) {
      if (isHistoric) {
        markMetricFailed(args.parsed.intentId, resolvedMetric, sampleCheck.reason);
      }
      appendObservationError({
        kind: "synthetic_setup_failed",
        message: sampleCheck.reason,
        intentId: args.parsed.intentId,
        sessionId: args.sessionId,
        metric: resolvedMetric,
      });
      for (const s of spawned) s.child.kill("SIGTERM");
      sessions.delete(args.sessionId);
      return sampleCheck.reason;
    }

    idx += 1;
    const mdir = join(runRoot, `m${idx}_${resolvedMetric.replace(/[^\w.-]+/gu, "_").slice(0, 160)}`);
    mkdirSync(mdir, { recursive: true });
    const snippetPath = join(mdir, "snippet.js.txt");
    const cfgPath = join(mdir, "worker-config.json");

    writeFileSync(snippetPath, codegenSlice.snippet, "utf8");
    writeObservationProgramLog({
      metric: resolvedMetric,
      program: codegenSlice.snippet,
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
          snippetPath,
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
      process.stderr.write(`synthetic spawn error (${resolvedMetric}): ${String(error)}\n`);
    });

    if (isHistoric) {
      markCodegenComplete(args.parsed.intentId, resolvedMetric, cp.pid ?? undefined);
    }
    codegenDone += 1;

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
        message: `Synthetic worker for ${resolvedMetric} exited with code ${code}${signalNote}`,
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
    `Started ${spawned.length} synthetic observation worker process(es); ${modeTail}.`,
    `Run directory: ${runRoot}`,
    `Program logs: ${logsRoot}/observation-program-<metric>.js`,
    "Metrics:",
    ...tails,
    "`observe status` lists stream + synthetic PIDs.",
    "`observe synthetic stop` stops synthetic workers.",
    "`observe stop` stops both legacy streams and synthetic workers."
  ].join("\n");
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
    createIntentStorage: opts.createIntentStorage
  };

  void startSyntheticObservationFromParsed(runArgs)
    .then((detail) => {
      process.stderr.write(
        `[synthetic-background] session=${opts.sessionId} intent=${parsed.value.intentId}\n${detail}\n`
      );
    })
    .catch((error) => {
      appendObservationError({
        kind: "synthetic_worker_exit",
        message: `Synthetic observation background run failed: ${error instanceof Error ? error.message : String(error)}`,
        intentId: parsed.value.intentId,
        sessionId: opts.sessionId
      });
    });

  const modeNote =
    parsed.value.mode === "historic" ? "historic replay" : "streaming";
  return {
    started: true,
    assistantText: [
      `Synthetic observation generation for intent ${parsed.value.intentId} is starting in the background (${modeNote}, ${parsed.value.metricSlices.length} metric(s)).`,
      "Codegen and worker processes run asynchronously; data will appear in storage as metrics complete.",
      "You can continue this dialogue while generation runs. Use `observe status` to list synthetic worker PIDs for this session."
    ].join("\n")
  };
}
