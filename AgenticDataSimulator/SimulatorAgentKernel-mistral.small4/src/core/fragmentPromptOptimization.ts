import type { IntentDraft } from "../models.js";

export const FRAGMENT_MINIMAL_SYSTEM = `You are a TM Forum intent fragment authoring assistant for 5G4Data.
Generate only the Turtle body requested by the fragment module.
Use runtime grounding context as authoritative when provided.
Never emit icm:Intent, imo:handler, imo:owner, or @prefix lines.
No markdown fences and no narration.`;

const SELECTED_WORKLOAD_TAG = "[selected workload objectives]";

/** Default on; set FRAGMENT_OPTIMIZE_TOKENS=false to restore full prompts. */
export function isFragmentTokenOptimizationEnabled(): boolean {
  const raw = process.env.FRAGMENT_OPTIMIZE_TOKENS?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

export function fragmentMaxAttempts(fragmentId: string): number {
  const envRaw = process.env.FRAGMENT_MAX_ATTEMPTS?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  if (
    fragmentId === "coordination" ||
    fragmentId === "deployment" ||
    fragmentId === "sustainability"
  ) {
    return 3;
  }
  return 2;
}

export function compactDraftContextJson(draft: IntentDraft): string {
  const sharedCxLocal =
    draft.fragments.flatMap((f) => f.locals).find((local) => local.startsWith("CX")) ?? null;
  const deploymentDe = draft.fragments.flatMap((f) => f.locals).find((local) => local.startsWith("DE"));
  const sustainabilitySe = draft.fragments
    .flatMap((f) => f.locals)
    .find((local) => local.startsWith("SE"));
  const coLocals = draft.fragments.flatMap((f) => f.locals.filter((l) => l.startsWith("CO")));
  return JSON.stringify({
    intentDescription: draft.intentDescription,
    priorFragments: draft.fragments.map((f) => ({ id: f.id, locals: f.locals })),
    sharedCxLocal,
    deploymentDeLocal: deploymentDe ?? null,
    sustainabilitySeLocal: sustainabilitySe ?? null,
    conditionLocals: coLocals
  });
}

function parseRuntimeContextSections(runtimeContext: string): Map<string, string> {
  const sections = new Map<string, string>();
  const headerRe = /^\[(?!selected workload objectives\])([^\]]+)\]\s*$/gm;
  const matches = [...runtimeContext.matchAll(headerRe)];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const name = match[1]?.trim();
    if (!name) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? runtimeContext.length) : runtimeContext.length;
    sections.set(name, runtimeContext.slice(start, end).trim());
  }
  return sections;
}

function extractSelectedWorkloadBlock(runtimeContext: string): string | null {
  const idx = runtimeContext.indexOf(SELECTED_WORKLOAD_TAG);
  if (idx < 0) return null;
  const afterTag = runtimeContext.slice(idx + SELECTED_WORKLOAD_TAG.length);
  const nextHeader = afterTag.search(/^\[(?!selected workload objectives\])[^\]]+\]\s*$/m);
  const body =
    nextHeader >= 0 ? afterTag.slice(0, nextHeader) : afterTag;
  return `${SELECTED_WORKLOAD_TAG}${body}`.trim();
}

function trimGraphDbForDeployment(graphDbSection: string): string {
  const lines = graphDbSection.split("\n");
  const kept: string[] = [];
  let inIntentTurtle = false;
  for (const line of lines) {
    if (/^\[Controller graph target\]/i.test(line.trim())) continue;
    if (/^\[Intent Turtle for /i.test(line.trim())) {
      inIntentTurtle = true;
      continue;
    }
    if (inIntentTurtle) continue;
    if (/^\[Observation Metrics\]/i.test(line.trim())) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function sliceRuntimeContextForFragment(runtimeContext: string, fragmentId: string): string {
  if (!runtimeContext.trim()) return "No runtime grounding context.";
  if (fragmentId === "coordination") {
    return "Coordination fragment uses deterministic assembly from prior fragment locals.";
  }

  const sections = parseRuntimeContextSections(runtimeContext);
  const catalogue = sections.get("Workload catalogue") ?? "";
  const selectedWorkload = extractSelectedWorkloadBlock(runtimeContext);
  const blocks: string[] = [];

  switch (fragmentId) {
    case "deployment": {
      if (selectedWorkload) {
        blocks.push(`[Workload catalogue]\n${selectedWorkload}`);
      } else if (catalogue) {
        blocks.push(`[Workload catalogue]\n${catalogue}`);
      }
      const graphDb = sections.get("GraphDB");
      if (graphDb) {
        blocks.push(`[GraphDB]\n${trimGraphDbForDeployment(graphDb)}`);
      }
      const workflow = sections.get("Workflow override");
      if (workflow && workflow !== "No workflow override.") {
        blocks.push(`[Workflow override]\n${workflow}`);
      }
      break;
    }
    case "sustainability": {
      if (selectedWorkload) {
        blocks.push(`[Workload catalogue]\n${selectedWorkload}`);
      } else if (catalogue) {
        blocks.push(`[Workload catalogue]\n${catalogue}`);
      }
      break;
    }
    case "network": {
      const graphDb = sections.get("GraphDB");
      if (graphDb) blocks.push(`[GraphDB]\n${graphDb}`);
      if (selectedWorkload) {
        blocks.push(`[Workload catalogue]\n${selectedWorkload}`);
      }
      break;
    }
    default: {
      if (selectedWorkload) blocks.push(`[Workload catalogue]\n${selectedWorkload}`);
      else if (catalogue) blocks.push(`[Workload catalogue]\n${catalogue}`);
      const graphDb = sections.get("GraphDB");
      if (graphDb) blocks.push(`[GraphDB]\n${graphDb}`);
    }
  }

  return blocks.length > 0 ? blocks.join("\n\n") : "No fragment-specific runtime context.";
}

export function estimatePromptTokens(charCount: number): number {
  return Math.max(1, Math.ceil(charCount / 4));
}
