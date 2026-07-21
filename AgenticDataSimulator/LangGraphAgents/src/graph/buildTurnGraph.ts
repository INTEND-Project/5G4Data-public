import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentTurnAnnotation, type AgentTurnState } from "./state.js";
import type { AgentTurnResult, ChatSession } from "../models.js";

export type TurnGraphHandlers = {
  replHook: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  confirm: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  classify: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  context: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  prompt: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  generate: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  repair: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  postprocess: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  shacl: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  persist: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
  finalize: (state: AgentTurnState) => Promise<Partial<AgentTurnState>>;
};

/**
 * Compile the package-driven agent turn as a LangGraph StateGraph.
 * Conditional edges: REPL short-circuit; fragmented vs single generation is inside `generate`.
 */
export function buildTurnGraph(handlers: TurnGraphHandlers) {
  const graph = new StateGraph(AgentTurnAnnotation)
    .addNode("replHook", handlers.replHook)
    .addNode("confirm", handlers.confirm)
    .addNode("classify", handlers.classify)
    .addNode("context", handlers.context)
    .addNode("prompt", handlers.prompt)
    .addNode("generate", handlers.generate)
    .addNode("repair", handlers.repair)
    .addNode("postprocess", handlers.postprocess)
    // Node names must not collide with state channel names (`shacl`, `persist`).
    .addNode("validateShacl", handlers.shacl)
    .addNode("persistIntent", handlers.persist)
    .addNode("finalize", handlers.finalize)
    .addEdge(START, "replHook")
    .addConditionalEdges("replHook", (state) => (state.replHandled ? "finalize" : "confirm"), {
      finalize: "finalize",
      confirm: "confirm"
    })
    .addEdge("confirm", "classify")
    .addEdge("classify", "context")
    .addEdge("context", "prompt")
    .addEdge("prompt", "generate")
    .addEdge("generate", "repair")
    .addEdge("repair", "postprocess")
    .addEdge("postprocess", "validateShacl")
    .addEdge("validateShacl", "persistIntent")
    .addEdge("persistIntent", "finalize")
    .addEdge("finalize", END);

  return graph.compile();
}

export type CompiledTurnGraph = ReturnType<typeof buildTurnGraph>;

export type TurnGraphInvokeInput = {
  session: ChatSession;
  userText: string;
  turnId: string;
  hooks?: {
    replHookDebug?: boolean;
    replHookDebugLogPath?: string;
  };
};

export async function invokeTurnGraph(
  graph: CompiledTurnGraph,
  input: TurnGraphInvokeInput
): Promise<AgentTurnResult> {
  const finalState = await graph.invoke({
    session: input.session,
    userText: input.userText,
    turnId: input.turnId,
    hooks: input.hooks
  });
  if (!finalState.turnResult) {
    throw new Error("LangGraph turn finalized without turnResult");
  }
  return finalState.turnResult;
}
