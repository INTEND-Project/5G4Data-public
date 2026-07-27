import { Annotation } from "@langchain/langgraph";
import type {
  ChatSession,
  IntentDraft,
  LlmCallRecord,
  AgentTurnResult
} from "../models.js";
import type { IntentFlags } from "../core/workflowEngine.js";

export type ShaclNodeResult = {
  text: string;
  conforms: boolean;
  attempts: number;
  violations: unknown[];
  reportText: string;
};

export type PersistNodeResult = {
  persisted: boolean;
  intentId: string | null;
  skipped?: boolean;
};

/**
 * LangGraph turn state. Session is mutated in place for confirmation history;
 * other fields are per-turn accumulators.
 */
export const AgentTurnAnnotation = Annotation.Root({
  session: Annotation<ChatSession>,
  userText: Annotation<string>,
  turnId: Annotation<string>,
  effectiveUserText: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => ""
  }),
  confirmationAck: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  intentFlags: Annotation<IntentFlags>({
    reducer: (_left, right) => right,
    default: () => ({ deployment: false, locality: false, networkQos: false })
  }),
  runtimeContext: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => ""
  }),
  knownMetricStems: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
  modules: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
  systemBlocks: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => []
  }),
  assistantText: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => ""
  }),
  replHandled: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false
  }),
  generationMode: Annotation<"single" | "fragmented">({
    reducer: (_left, right) => right,
    default: () => "single"
  }),
  intentDraft: Annotation<IntentDraft | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined
  }),
  shacl: Annotation<ShaclNodeResult | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined
  }),
  persist: Annotation<PersistNodeResult | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined
  }),
  warnings: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => []
  }),
  debug: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => []
  }),
  calls: Annotation<LlmCallRecord[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => []
  }),
  traceTags: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({})
  }),
  traceMetadata: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({})
  }),
  turnResult: Annotation<AgentTurnResult | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined
  }),
  hooks: Annotation<
    | {
        replHookDebug?: boolean;
        replHookDebugLogPath?: string;
      }
    | undefined
  >({
    reducer: (_left, right) => right,
    default: () => undefined
  })
});

export type AgentTurnState = typeof AgentTurnAnnotation.State;
