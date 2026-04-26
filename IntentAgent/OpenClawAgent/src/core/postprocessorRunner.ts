import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoadedDomainPackage, PostprocessorConfig } from "./packageLoader.js";
import type { ValidatorRules } from "./packageLoader.js";
import type { IntentFlags } from "./workflowEngine.js";

export interface PostprocessorContext {
  runtimeContext: string;
  intentFlags: IntentFlags;
  validatorRules: ValidatorRules;
}

interface PostprocessorModule {
  applyPostprocessor: (args: {
    text: string;
    context: PostprocessorContext;
  }) => Promise<{ text: string; changes: number; note?: string }> | { text: string; changes: number; note?: string };
}

export async function runConfiguredPostprocessors(args: {
  text: string;
  context: PostprocessorContext;
  domainPackage: LoadedDomainPackage;
  when: "on_validation_failure" | "always";
  debug: string[];
}): Promise<string> {
  const applicable = args.domainPackage.postprocessors.filter(
    (p) => (p.when ?? "on_validation_failure") === args.when
  );
  let current = args.text;
  for (const postprocessor of applicable) {
    current = await runOne(current, args.context, args.domainPackage, postprocessor, args.debug);
  }
  return current;
}

async function runOne(
  text: string,
  context: PostprocessorContext,
  domainPackage: LoadedDomainPackage,
  postprocessor: PostprocessorConfig,
  debug: string[]
): Promise<string> {
  const modulePath = join(domainPackage.packageDir, postprocessor.module);
  const moduleUrl = pathToFileURL(modulePath).href;
  const mod = (await import(moduleUrl)) as Partial<PostprocessorModule>;
  if (!mod.applyPostprocessor) {
    throw new Error(`Postprocessor module missing applyPostprocessor export: ${postprocessor.module}`);
  }
  const result = await mod.applyPostprocessor({ text, context });
  if (result.changes > 0) {
    debug.push(`postprocessor_applied=${postprocessor.id} changes=${result.changes}`);
    if (result.note) debug.push(`postprocessor_note_${postprocessor.id}=${result.note}`);
  }
  return result.text;
}
