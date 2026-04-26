import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  workflow: z.string().min(1),
  promptModulesDir: z.string().min(1),
  systemPromptFile: z.string().min(1),
  rules: z.object({
    classification: z.string().min(1),
    context: z.string().min(1)
  }),
  validators: z.string().min(1),
  toolBindings: z.string().min(1),
  postprocessors: z.string().min(1).optional()
});

const workflowSchema = z.object({
  confirmation: z
    .object({
      acceptedUserInputs: z.array(z.string().min(1)).min(1),
      assistantMarkers: z.array(z.string().min(1)).min(1),
      forceGenerateInstruction: z.string().min(1)
    })
    .optional(),
  stages: z.array(
    z.object({
      id: z.string().min(1),
      includeModules: z.array(z.string().min(1)),
      whenIntentFlags: z.array(z.string().min(1)).optional(),
      confirmationRequired: z.boolean().optional()
    })
  )
});

const classificationRulesSchema = z.object({
  intentFlags: z.record(z.array(z.string().min(1)))
});

const contextRulesSchema = z.object({
  baseCapabilities: z.array(z.string().min(1)),
  intentCapabilities: z.record(z.array(z.string().min(1))),
  prompts: z.object({
    runtimeContextHeader: z.string().min(1),
    deploymentDatacenterClarificationTag: z.string().min(1),
    selectedWorkloadTag: z.string().min(1)
  })
});

const validatorsSchema = z.object({
  forbiddenPhrases: z.array(z.string().min(1)),
  requiredTokens: z.array(z.string().min(1)),
  clarificationTag: z.string().min(1).optional(),
  conditionalRequirements: z.array(
    z.object({
      intentFlag: z.string().min(1),
      requiresAnyTokens: z.array(z.string().min(1)).min(1),
      error: z.string().min(1)
    })
  ),
  identifierRules: z
    .array(
      z.object({
        regex: z.string().min(1),
        error: z.string().min(1),
        validateAsUuid4Suffix: z.boolean().optional()
      })
    )
    .optional()
});

const toolBindingsSchema = z.object({
  capabilities: z.record(
    z.object({
      adapter: z.string().min(1)
    })
  )
});

const postprocessorSchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  when: z.enum(["on_validation_failure", "always"]).optional()
});

const postprocessorsSchema = z.object({
  postprocessors: z.array(postprocessorSchema)
});

export type PackageManifest = z.infer<typeof manifestSchema>;
export type WorkflowDsl = z.infer<typeof workflowSchema>;
export type ClassificationRules = z.infer<typeof classificationRulesSchema>;
export type ContextRules = z.infer<typeof contextRulesSchema>;
export type ValidatorRules = z.infer<typeof validatorsSchema>;
export type ToolBindings = z.infer<typeof toolBindingsSchema>;
export type PostprocessorConfig = z.infer<typeof postprocessorSchema>;

export interface LoadedDomainPackage {
  packageDir: string;
  manifest: PackageManifest;
  workflow: WorkflowDsl;
  classificationRules: ClassificationRules;
  contextRules: ContextRules;
  validatorRules: ValidatorRules;
  toolBindings: ToolBindings;
  postprocessors: PostprocessorConfig[];
  systemPromptText: string;
  promptModules: Record<string, string>;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`Required package file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Required package file not found: ${path}`);
  }
  return readFileSync(path, "utf8").trim();
}

export function loadDomainPackage(packageDirInput: string): LoadedDomainPackage {
  const packageDir = resolve(packageDirInput);
  const manifestPath = join(packageDir, "manifest.json");
  const manifest = manifestSchema.parse(readJson(manifestPath));

  const workflow = workflowSchema.parse(readJson(join(packageDir, manifest.workflow)));
  const classificationRules = classificationRulesSchema.parse(
    readJson(join(packageDir, manifest.rules.classification))
  );
  const contextRules = contextRulesSchema.parse(readJson(join(packageDir, manifest.rules.context)));
  const validatorRules = validatorsSchema.parse(readJson(join(packageDir, manifest.validators)));
  const toolBindings = toolBindingsSchema.parse(readJson(join(packageDir, manifest.toolBindings)));
  const postprocessors = manifest.postprocessors
    ? postprocessorsSchema.parse(readJson(join(packageDir, manifest.postprocessors))).postprocessors
    : [];
  const systemPromptText = readText(join(packageDir, manifest.systemPromptFile));

  const promptModulesDir = join(packageDir, manifest.promptModulesDir);
  if (!existsSync(promptModulesDir)) {
    throw new Error(`Prompt modules directory not found: ${promptModulesDir}`);
  }
  const promptModules: Record<string, string> = {};
  for (const file of readdirSync(promptModulesDir)) {
    if (!file.endsWith(".md")) continue;
    promptModules[file.replace(/\.md$/, "")] = readText(join(promptModulesDir, file));
  }

  return {
    packageDir,
    manifest,
    workflow,
    classificationRules,
    contextRules,
    validatorRules,
    toolBindings,
    postprocessors,
    systemPromptText,
    promptModules
  };
}
