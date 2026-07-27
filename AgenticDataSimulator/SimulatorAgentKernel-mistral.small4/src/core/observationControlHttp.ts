import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type ObservationHttpControlModule = {
  handleObservationProgressHttp: (intentId: string) => Record<string, unknown>;
  handleObservationErrorsHttp: (input?: {
    since?: string;
    limit?: number;
  }) => { errors: unknown[] };
};

let cachedPackageDir: string | null = null;
let cachedModule: ObservationHttpControlModule | null | undefined;

async function loadModule(
  packageDir: string,
): Promise<ObservationHttpControlModule | null> {
  if (cachedPackageDir === packageDir && cachedModule !== undefined) {
    return cachedModule;
  }

  const modPath = join(packageDir, "tools", "observationHttpControl.ts");
  if (!existsSync(modPath)) {
    cachedPackageDir = packageDir;
    cachedModule = null;
    return null;
  }

  const imported = (await import(pathToFileURL(modPath).href)) as ObservationHttpControlModule;
  cachedPackageDir = packageDir;
  cachedModule = imported;
  return imported;
}

export async function resolveObservationProgress(
  packageDir: string,
  intentId: string,
): Promise<Record<string, unknown> | null> {
  const mod = await loadModule(packageDir);
  if (!mod) return null;
  return mod.handleObservationProgressHttp(intentId);
}

export async function resolveObservationErrors(
  packageDir: string,
  input?: { since?: string; limit?: number },
): Promise<{ errors: unknown[] } | null> {
  const mod = await loadModule(packageDir);
  if (!mod) return null;
  return mod.handleObservationErrorsHttp(input);
}
