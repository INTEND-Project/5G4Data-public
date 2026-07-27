import { Parser } from "n3";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ChatSession,
  IntentDraft,
  IntentDraftFragment,
  LlmCallRecord,
  ModelInvocationResult,
  ModelInvokeOptions
} from "../models.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { extractTurtlePayload } from "./outputPolicyValidator.js";
import type { IntentFlags } from "./workflowEngine.js";
import { previewText } from "../tracing/langsmith.js";
import {
  compactDraftContextJson,
  estimatePromptTokens,
  fragmentMaxAttempts,
  FRAGMENT_MINIMAL_SYSTEM,
  isFragmentTokenOptimizationEnabled,
  sliceRuntimeContextForFragment
} from "./fragmentPromptOptimization.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

export interface FragmentGenerationInput {
  session: ChatSession;
  domainPackage: LoadedDomainPackage;
  intentFlags: IntentFlags;
  effectiveUserText: string;
  runtimeContext: string;
  reportingIntervalHint: string;
  invokeModel: (
    messages: ModelMessage[],
    options?: ModelInvokeOptions
  ) => Promise<ModelInvocationResult>;
  modelInvokeOptions: (stage: string) => ModelInvokeOptions;
  debug: string[];
}

export interface FragmentGenerationResult {
  text: string;
  calls: LlmCallRecord[];
  draft: IntentDraft;
  fragmentIds: string[];
  assembledChars: number;
}

interface AssemblerModule {
  assembleIntent: (args: {
    draft: IntentDraft;
    packageDir: string;
    userPrompt: string;
    canonicalPrefixesFile?: string;
  }) => { text: string; intentLocal: string; members: string[] };
}

function collectFragmentLocals(turtle: string): string[] {
  const locals = new Set<string>();
  for (const match of turtle.matchAll(/\bdata5g:([A-Za-z0-9_]+)\s+a\b/gi)) {
    if (match[1]) locals.add(match[1]);
  }
  return [...locals];
}

function extractData5gSubjectLines(raw: string): string {
  const lines = raw.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*data5g:[A-Za-z0-9_-]+\s+a\b/i.test(line)) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current.length > 0) {
      current.push(line);
      if (line.trimEnd().endsWith(".")) {
        blocks.push(current.join("\n"));
        current = [];
      }
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks.join("\n\n").trim();
}

function stripFragmentOutput(raw: string): string {
  let text = extractTurtlePayload(raw.trim());
  text = text.replace(/^```(?:turtle|ttl)?\s*/im, "").replace(/```\s*$/m, "").trim();
  const prefixIndex = text.search(/^@prefix\s/m);
  if (prefixIndex >= 0) {
    text = text.slice(0, prefixIndex).trim();
  }
  const intentIndex = text.search(/\bicm:Intent\b/i);
  if (intentIndex >= 0) {
    const before = text.slice(0, intentIndex);
    const subjectStart = before.lastIndexOf("data5g:");
    text = subjectStart >= 0 ? before.slice(0, subjectStart).trim() : before.trim();
  }
  text = text.trim();
  if (text.length < 20 || !/\bdata5g:[A-Za-z0-9_-]+\s+a\b/i.test(text)) {
    const recovered = extractData5gSubjectLines(raw);
    if (recovered.length >= 20) return recovered;
  }
  return text;
}


/** Domain policy modules referenced by fragment modules (small; omit full SKILL). */
const DOMAIN_MODULE_BY_FRAGMENT: Record<string, string> = {
  deployment: "deployment",
  sustainability: "sustainability",
  network: "network"
};

async function normalizeFragmentBody(
  packageDir: string,
  body: string,
  fragmentId: string
): Promise<{ text: string; changes: number }> {
  const modulePath = join(packageDir, "tools/normalizeFragmentTurtle.ts");
  try {
    const mod = (await import(pathToFileURL(modulePath).href)) as {
      normalizeFragmentTurtle?: (
        text: string,
        opts?: { fragmentId?: string }
      ) => { text: string; changes: number };
    };
    if (mod.normalizeFragmentTurtle) {
      return mod.normalizeFragmentTurtle(body, { fragmentId });
    }
  } catch {
    // optional package tool
  }
  return { text: body, changes: 0 };
}

async function importPackageTool<T>(packageDir: string, moduleName: string): Promise<T> {
  const modulePath = join(packageDir, `tools/${moduleName}`);
  return (await import(pathToFileURL(modulePath).href)) as T;
}

async function buildCoordinationStub(
  packageDir: string,
  draft: IntentDraft,
  userPrompt: string
): Promise<string> {
  const mod = await importPackageTool<{
    buildCoordinationFragment?: (input: {
      draft: IntentDraft;
      userPrompt: string;
    }) => string;
  }>(packageDir, "buildCoordinationFragment.ts");
  if (!mod.buildCoordinationFragment) {
    throw new Error("buildCoordinationFragment is not exported from package");
  }
  return mod.buildCoordinationFragment({ draft, userPrompt });
}

async function buildDeploymentStub(
  packageDir: string,
  runtimeContext: string,
  reportingIntervalHint: string,
  userPrompt: string
): Promise<string> {
  const mod = await importPackageTool<{
    buildDeploymentFragment?: (input: {
      runtimeContext: string;
      reportingIntervalHint: string;
      userPrompt?: string;
      selectedDataCenter?: string | null;
    }) => string;
  }>(packageDir, "buildDeploymentFragment.ts");
  if (!mod.buildDeploymentFragment) {
    throw new Error("buildDeploymentFragment is not exported from package");
  }
  const { resolveDataCenter } = await importPackageTool<{
    resolveDataCenter?: (runtimeContext: string) => string | null;
  }>(packageDir, "fragmentContextParse.ts");
  const selectedDataCenter =
    typeof resolveDataCenter === "function" ? resolveDataCenter(runtimeContext) : null;
  return mod.buildDeploymentFragment({
    runtimeContext,
    reportingIntervalHint,
    userPrompt,
    selectedDataCenter
  });
}

async function buildSustainabilityStub(
  packageDir: string,
  draft: IntentDraft,
  runtimeContext: string,
  reportingIntervalHint: string
): Promise<string> {
  const mod = await importPackageTool<{
    buildSustainabilityFragment?: (input: {
      draft: IntentDraft;
      runtimeContext: string;
      reportingIntervalHint: string;
    }) => string;
  }>(packageDir, "buildSustainabilityFragment.ts");
  if (!mod.buildSustainabilityFragment) {
    throw new Error("buildSustainabilityFragment is not exported from package");
  }
  return mod.buildSustainabilityFragment({ draft, runtimeContext, reportingIntervalHint });
}

async function buildNetworkStub(
  packageDir: string,
  draft: IntentDraft,
  reportingIntervalHint: string
): Promise<string> {
  const mod = await importPackageTool<{
    buildNetworkFragment?: (input: {
      draft: IntentDraft;
      reportingIntervalHint: string;
    }) => string;
  }>(packageDir, "buildNetworkFragment.ts");
  if (!mod.buildNetworkFragment) {
    throw new Error("buildNetworkFragment is not exported from package");
  }
  return mod.buildNetworkFragment({ draft, reportingIntervalHint });
}

function deterministicFragmentStubsEnabled(): boolean {
  const raw = process.env.FRAGMENT_DETERMINISTIC_STUBS?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

const FRAGMENT_PARSE_PREFIXES = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .
@prefix mf: <http://tio.models.tmforum.org/tio/v3.6.0/MathFunctions/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
`;

function removeIntentSubjectBlocks(turtle: string): string {
  const blocks: string[] = [];
  const lines = turtle.split("\n");
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*data5g:[A-Za-z0-9_-]+\s+a\b/i.test(line)) {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current.length > 0) {
      current.push(line);
      if (line.trimEnd().endsWith(".")) {
        blocks.push(current.join("\n"));
        current = [];
      }
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks.filter((block) => !/\bicm:Intent\b/i.test(block)).join("\n\n").trim();
}

function validateFragmentBody(turtle: string, fragmentId: string): void {
  if (!turtle || turtle.length < 20) {
    throw new Error(`Fragment ${fragmentId} produced empty or too-short Turtle body`);
  }
  if (/@prefix\s/m.test(turtle)) {
    throw new Error(`Fragment ${fragmentId} must not include @prefix declarations`);
  }
  if (/\bicm:Intent\b/i.test(turtle)) {
    throw new Error(`Fragment ${fragmentId} must not include icm:Intent block`);
  }
  try {
    const parser = new Parser({ format: "text/turtle" });
    parser.parse(`${FRAGMENT_PARSE_PREFIXES}\n${turtle}`);
  } catch (error) {
    throw new Error(
      `Fragment ${fragmentId} Turtle syntax invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function activeFragments(
  domainPackage: LoadedDomainPackage,
  intentFlags: IntentFlags
): Array<{ id: string; promptModule: string }> {
  const generation = domainPackage.workflow.generation;
  if (!generation || generation.mode !== "fragmented") {
    throw new Error("Package workflow.generation.fragmented is required in kernel-mistral.small4");
  }
  return generation.fragments.filter((fragment) =>
    fragment.whenIntentFlags.some((flag) => Boolean(intentFlags[flag]))
  );
}

export class FragmentGenerationEngine {
  async generate(input: FragmentGenerationInput): Promise<FragmentGenerationResult> {
    const generation = input.domainPackage.workflow.generation;
    if (!generation || generation.mode !== "fragmented") {
      throw new Error("Fragmented generation is required in kernel-mistral.small4");
    }

    const fragments = activeFragments(input.domainPackage, input.intentFlags);
    if (fragments.length === 0) {
      throw new Error("No generation fragments matched intent flags");
    }

    const draft: IntentDraft = {
      intentDescription: input.effectiveUserText.trim(),
      fragments: []
    };
    input.session.intentDraft = draft;

    const calls: LlmCallRecord[] = [];
    const optimizeTokens = isFragmentTokenOptimizationEnabled();
    const useDeterministicStubs = deterministicFragmentStubsEnabled();
    input.debug.push(
      `fragment_token_optimize=${optimizeTokens} fragment_deterministic_stubs=${useDeterministicStubs}`
    );
    const sharedModuleNames = optimizeTokens
      ? ["reporting-storage"]
      : ["defaults", "reporting-storage"];
    const sharedModules = sharedModuleNames
      .map((name) => input.domainPackage.promptModules[name])
      .filter((text): text is string => Boolean(text?.trim()));
    const fragmentHistory: ModelMessage[] = optimizeTokens
      ? [{ role: "user", content: input.effectiveUserText }]
      : (input.session.messages.map((m) => ({
          role: m.role,
          content: m.text
        })) as ModelMessage[]);

    for (const fragment of fragments) {
      const moduleText = input.domainPackage.promptModules[fragment.promptModule];
      if (!moduleText?.trim()) {
        throw new Error(`Missing prompt module for fragment: ${fragment.promptModule}`);
      }

      const draftContext = compactDraftContextJson(draft);
      const runtimeContextForFragment = optimizeTokens
        ? sliceRuntimeContextForFragment(input.runtimeContext, fragment.id)
        : input.runtimeContext;
      const systemHeader = optimizeTokens
        ? FRAGMENT_MINIMAL_SYSTEM
        : input.domainPackage.systemPromptText;
      const domainModuleName = DOMAIN_MODULE_BY_FRAGMENT[fragment.id];
      const domainModuleText = domainModuleName
        ? input.domainPackage.promptModules[domainModuleName]
        : undefined;
      const systemBlocks = [
        systemHeader,
        ...sharedModules,
        ...(domainModuleText?.trim() ? [domainModuleText.trim()] : []),
        moduleText.trim(),
        `Draft context from prior fragments (reuse locals exactly when referenced):\n${draftContext}`,
        `Runtime grounding context:\n${runtimeContextForFragment}`,
        input.reportingIntervalHint,
        "Return Turtle body only for this fragment. No @prefix, no icm:Intent, no markdown fences, no narration."
      ];
      const promptChars =
        systemBlocks.join("\n").length + fragmentHistory.map((m) => m.content).join("\n").length;
      input.debug.push(
        `fragment_prompt=${fragment.id} optimize=${optimizeTokens} chars=${promptChars} est_tokens=${estimatePromptTokens(promptChars)}`
      );

      let body = "";
      let lastError = "";
      let lastRaw = "";
      let stubAttempted = false;

      if (useDeterministicStubs) {
        try {
          if (fragment.id === "coordination") {
            stubAttempted = true;
            body = await buildCoordinationStub(
              input.domainPackage.packageDir,
              draft,
              input.effectiveUserText
            );
            input.debug.push("fragment_stub=coordination deterministic");
          } else if (fragment.id === "deployment") {
            stubAttempted = true;
            body = await buildDeploymentStub(
              input.domainPackage.packageDir,
              input.runtimeContext,
              input.reportingIntervalHint,
              input.effectiveUserText
            );
            input.debug.push("fragment_stub=deployment deterministic");
          } else if (fragment.id === "sustainability") {
            stubAttempted = true;
            body = await buildSustainabilityStub(
              input.domainPackage.packageDir,
              draft,
              input.runtimeContext,
              input.reportingIntervalHint
            );
            input.debug.push("fragment_stub=sustainability deterministic");
          } else if (fragment.id === "network") {
            stubAttempted = true;
            body = await buildNetworkStub(
              input.domainPackage.packageDir,
              draft,
              input.reportingIntervalHint
            );
            input.debug.push("fragment_stub=network deterministic");
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          input.debug.push(`fragment_stub_failed=${fragment.id} reason=${lastError}`);
          if (stubAttempted) body = "";
        }
      }

      const maxAttempts = fragmentMaxAttempts(fragment.id);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const retryHint =
          attempt === 0
            ? ""
            : [
                `Prior ${fragment.id} fragment output failed (${lastError}).`,
                "You MUST return Turtle body only with separate data5g: subject blocks.",
                "Each block ends with . on its own line; use ; between predicates on the same subject.",
                lastRaw ? `Failed output preview:\n${previewText(lastRaw, optimizeTokens ? 300 : 600)}` : ""
              ]
                .filter(Boolean)
                .join("\n");
        if (!body) {
          const result = await input.invokeModel(
            [
              ...systemBlocks.map((content) => ({ role: "system" as const, content })),
              ...(retryHint ? [{ role: "system" as const, content: retryHint }] : []),
              ...fragmentHistory
            ],
            input.modelInvokeOptions(`fragment_${fragment.id}${attempt > 0 ? `_retry${attempt}` : ""}`)
          );
          calls.push(result.call);
          lastRaw = result.text;
          body = stripFragmentOutput(result.text);
          body = removeIntentSubjectBlocks(body);
        }
        const normalized = await normalizeFragmentBody(
          input.domainPackage.packageDir,
          body,
          fragment.id
        );
        if (normalized.changes > 0) {
          input.debug.push(`fragment_normalized=${fragment.id} changes=${normalized.changes}`);
        }
        body = normalized.text;
        try {
          validateFragmentBody(body, fragment.id);
          lastError = "";
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (stubAttempted && body) {
            input.debug.push(`fragment_stub_invalid=${fragment.id} reason=${lastError}`);
            stubAttempted = false;
            body = "";
          }
          if (attempt === maxAttempts - 1) throw error;
          input.debug.push(`fragment_retry=${fragment.id} attempt=${attempt + 1} reason=${lastError}`);
        }
      }
      const locals = collectFragmentLocals(body);
      const entry: IntentDraftFragment = { id: fragment.id, turtle: body, locals };
      draft.fragments.push(entry);
      input.debug.push(
        `fragment_generated=${fragment.id} locals=${locals.length} chars=${body.length}`
      );
    }

    const assemblerPath = join(input.domainPackage.packageDir, generation.assemblerModule);
    const assemblerMod = (await import(pathToFileURL(assemblerPath).href)) as Partial<AssemblerModule>;
    if (!assemblerMod.assembleIntent) {
      throw new Error(`Assembler module missing assembleIntent: ${generation.assemblerModule}`);
    }

    const assembled = assemblerMod.assembleIntent({
      draft,
      packageDir: input.domainPackage.packageDir,
      userPrompt: input.effectiveUserText,
      canonicalPrefixesFile: generation.canonicalPrefixesFile
        ? join(input.domainPackage.packageDir, generation.canonicalPrefixesFile)
        : undefined
    });

    input.debug.push(
      `fragments_assembled count=${draft.fragments.length} members=${assembled.members.length} chars=${assembled.text.length}`
    );

    return {
      text: assembled.text,
      calls,
      draft,
      fragmentIds: fragments.map((f) => f.id),
      assembledChars: assembled.text.length
    };
  }
}
