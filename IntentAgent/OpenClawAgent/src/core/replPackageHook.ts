import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChatSession } from "../models.js";
import type { LoadedDomainPackage } from "./packageLoader.js";

export interface ReplHookInput {
  line: string;
  session: ChatSession;
  domainPackage: LoadedDomainPackage;
  debug: boolean;
  debugLogPath: string;
  graphDbEndpoint: string;
  graphDbNamedGraph: string;
  graphDbQueryLimit: number;
}

export async function tryReplPackageHook(
  input: ReplHookInput
): Promise<{ handled: boolean; assistantText?: string }> {
  const rel = input.domainPackage.manifest.runtimeHooks?.replPreTurn;
  if (!rel) return { handled: false };
  const abs = join(input.domainPackage.packageDir, rel);
  if (!existsSync(abs)) return { handled: false };
  try {
    const mod = (await import(pathToFileURL(abs).href)) as {
      handleReplLine?: (ctx: {
        line: string;
        session: ChatSession;
        debug: boolean;
        debugLogPath: string;
        packageDir: string;
        graphDbEndpoint: string;
        graphDbNamedGraph: string;
        graphDbQueryLimit: number;
      }) => Promise<{ handled: boolean; assistantText?: string }>;
    };
    if (!mod.handleReplLine) return { handled: false };
    return await mod.handleReplLine({
      line: input.line,
      session: input.session,
      debug: input.debug,
      debugLogPath: input.debugLogPath,
      packageDir: input.domainPackage.packageDir,
      graphDbEndpoint: input.graphDbEndpoint,
      graphDbNamedGraph: input.graphDbNamedGraph,
      graphDbQueryLimit: input.graphDbQueryLimit
    });
  } catch {
    return { handled: false };
  }
}

export async function shutdownObservationStreamsIfPresent(packageDir: string): Promise<void> {
  const modPath = join(packageDir, "tools", "observationStreamCoordinator.ts");
  if (!existsSync(modPath)) return;
  try {
    const mod = (await import(pathToFileURL(modPath).href)) as {
      stopAllObservationStreams?: () => void;
    };
    mod.stopAllObservationStreams?.();
  } catch {
    /* ignore */
  }
}
