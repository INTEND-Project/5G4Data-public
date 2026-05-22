export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n/m, "").trim();
}

export function buildSystemPrompt(systemPromptText: string, skillText: string): string {
  const trimmedSkill = stripFrontmatter(skillText);
  return `${systemPromptText.trim()}

Use the following workflow specification as binding domain guidance.
Follow it closely, but do not quote it unless asked.

${trimmedSkill}`;
}

export function deploymentLookupInstruction(
  deploymentNeeded: boolean,
  catalogueSummary: string,
  fullCatalogMode: boolean
): string {
  if (!deploymentNeeded) return "No deployment workflow override is needed for this turn.";

  if (fullCatalogMode) {
    return [
      "Deployment-like request detected. You MUST inspect workload catalogue entries in runtime context",
      "before asking any workload-selection question. Use chart names and descriptions semantically.",
      "If one workload is clearly best, choose it; otherwise ask one concise disambiguation question.",
      "Do not ask generic workload prompts before checking the provided catalogue entries.",
      "If network QoS is needed, include deployment and network expectations together when appropriate."
    ].join(" ");
  }

  return [
    "Deployment-like request detected, but catalogue is too large for full-catalog mode.",
    "Shortlist mode is required before asking user to choose workload.",
    `Current catalogue state: ${catalogueSummary}`
  ].join(" ");
}

export function requestImpliesDeployment(userText: string): boolean {
  const lowered = userText.toLowerCase();
  return [
    "deploy",
    "deployment",
    "model",
    "llm",
    "inference",
    "workload",
    "edge",
    "run close",
    "application",
    "private dialogue"
  ].some((signal) => lowered.includes(signal));
}

export function requestImpliesLocality(userText: string): boolean {
  const lowered = userText.toLowerCase();
  return [
    "near ",
    "close to",
    "nearby",
    "closest",
    "location",
    "city",
    "region",
    "edge",
    "local"
  ].some((signal) => lowered.includes(signal));
}

export function buildToolContext(parts: {
  ontologySummary: string;
  exampleSummary: string;
  catalogueSummary: string;
  graphDbSummary: string;
  workflowOverride: string;
}): string {
  return `Runtime grounding context:

[Ontology]
${parts.ontologySummary}

[Example intents]
${parts.exampleSummary}

[Workload catalogue]
${parts.catalogueSummary}

[GraphDB]
${parts.graphDbSummary}

[Workflow override]
${parts.workflowOverride}
`;
}
