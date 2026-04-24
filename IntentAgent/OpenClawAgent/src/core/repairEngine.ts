import { collectOutputIssues } from "./outputPolicyValidator.js";

export interface RepairContext {
  runtimeContext: string;
  userText: string;
}

export class RepairEngine {
  constructor(private readonly invokeModel: (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) => Promise<string>) {}

  async repairIfNeeded(
    responseText: string,
    context: RepairContext,
    systemBlocks: string[],
    history: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<{ text: string; debug: string[] }> {
    const debug: string[] = [];
    const issues = collectOutputIssues({
      text: responseText,
      userText: context.userText,
      runtimeContext: context.runtimeContext
    });
    if (issues.length === 0) return { text: responseText, debug };
    debug.push("output_policy_violation_detected=true");
    const issuesBlock = issues.map((i) => `- ${i}`).join("\n");
    const repairInstruction = `Your previous response violated output policy.
Rewrite now following all rules exactly. Return either:
1) concise summary + confirmation question (if not confirmed), or
2) final Turtle intent (only if user confirmed), or
3) at most 2 concise clarifying questions.

Validation failures to fix:
${issuesBlock}

Previous invalid response:
${responseText}`;
    const repaired = await this.invokeModel([
      ...systemBlocks.map((content) => ({ role: "system" as const, content })),
      ...history,
      { role: "user" as const, content: repairInstruction }
    ]);
    const secondIssues = collectOutputIssues({
      text: repaired,
      userText: context.userText,
      runtimeContext: context.runtimeContext
    });
    if (secondIssues.length > 0) {
      debug.push("output_repair_still_invalid=true");
      return {
        text: "I cannot produce a valid final Turtle intent yet. Please provide missing deployment/network constraints or ask me to regenerate with strict validation.",
        debug
      };
    }
    return { text: repaired, debug };
  }
}
