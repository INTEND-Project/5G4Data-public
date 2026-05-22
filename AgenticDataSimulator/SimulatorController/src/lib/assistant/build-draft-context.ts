type DraftContextInput = {
  selectedDomain: string;
  availableAgents: string[];
  metricNames: string[];
  stage: "discovery" | "reporting";
  assistantModel: string;
};

export function buildDraftContext(input: DraftContextInput) {
  return {
    selectedDomain: input.selectedDomain,
    availableAgents: input.availableAgents,
    metricNames: input.metricNames,
    stage: input.stage,
    assistantModel: input.assistantModel,
    promptHints: [
      `Use derived metric names such as ${input.metricNames.join(", ")}.`,
      `Generate snippets that match the ${input.stage} stage of the script.`,
    ],
  };
}
