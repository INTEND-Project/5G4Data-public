import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import {
  clampReportingIntervalMinutes,
  clampReportingIntervalSeconds
} from "../config.js";
import type {
  AgentTurnResult,
  ChatMessage,
  ChatSession,
  ModelInvocationResult,
  ModelInvokeOptions
} from "../models.js";
import { buildTurnGraph, invokeTurnGraph, type CompiledTurnGraph } from "../graph/buildTurnGraph.js";
import { createTurnHandlers } from "../graph/createTurnHandlers.js";
import type { LoadedDomainPackage } from "./packageLoader.js";
import { looksLikeTurtleIntent } from "./outputPolicyValidator.js";
import { RuntimeContextBuilder } from "./runtimeContextBuilder.js";
import { WorkflowEngine } from "./workflowEngine.js";
import { traceAgentTurn } from "../tracing/langsmith.js";

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Public facade for a compiled, package-driven LangGraph turn workflow.
 */
export class TurnOrchestrator {
  private readonly contextBuilder: RuntimeContextBuilder;
  private readonly workflowEngine: WorkflowEngine;
  private readonly graph: CompiledTurnGraph;

  constructor(
    private readonly config: AppConfig,
    private readonly domainPackage: LoadedDomainPackage,
    private readonly invokeModel: (
      messages: ModelMessage[],
      options?: ModelInvokeOptions
    ) => Promise<ModelInvocationResult>
  ) {
    this.contextBuilder = new RuntimeContextBuilder(config, domainPackage);
    this.workflowEngine = new WorkflowEngine(domainPackage);
    this.graph = buildTurnGraph(
      createTurnHandlers({
        config,
        domainPackage,
        invokeModel,
        contextBuilder: this.contextBuilder,
        workflowEngine: this.workflowEngine
      })
    );
  }

  async runTurn(
    session: ChatSession,
    userText: string,
    hooks?: {
      replHookDebug?: boolean;
      replHookDebugLogPath?: string;
    }
  ): Promise<AgentTurnResult> {
    const turnId = randomUUID();
    return traceAgentTurn({
      sessionId: session.sessionId,
      turnId,
      userText,
      fn: () => invokeTurnGraph(this.graph, { session, userText, turnId, hooks })
    });
  }

  getDomainPackage(): LoadedDomainPackage {
    return this.domainPackage;
  }

  getAppConfig(): AppConfig {
    return this.config;
  }

  async resolveWorkloadPreview(
    userText: string,
    graphTargetBinding?: import("../models.js").GraphTargetBinding | null
  ) {
    return this.contextBuilder.resolveWorkloadPreview(
      userText,
      this.workflowEngine.classifyIntent(userText),
      graphTargetBinding
    );
  }
}

export type ReportingIntervalForPostprocessor = {
  reportingIntervalMinutes?: number;
  reportingIntervalSeconds?: number;
};

export function resolveReportingIntervalForPostprocessor(
  session: ChatSession,
  envDefaultMinutes: number
): ReportingIntervalForPostprocessor {
  if (session.reportingIntervalSecondsOverride != null) {
    return {
      reportingIntervalSeconds: clampReportingIntervalSeconds(
        session.reportingIntervalSecondsOverride
      )
    };
  }
  return {
    reportingIntervalMinutes: clampReportingIntervalMinutes(
      session.reportingIntervalMinutesOverride ?? envDefaultMinutes
    )
  };
}

export function graphDbPersistEligibility(args: {
  text: string;
  confirmationAck: boolean;
  shaclConforms: boolean;
  noGraphDb: boolean;
}): { eligible: boolean; skipReason?: string } {
  // Keep this public policy helper stable for direct unit tests and consumers.
  if (!looksLikeTurtleIntent(args.text)) {
    return { eligible: false, skipReason: "not_turtle_intent" };
  }
  if (args.noGraphDb) return { eligible: false, skipReason: "no_graphdb" };
  if (!args.confirmationAck) return { eligible: false, skipReason: "not_synthesis_turn" };
  if (!args.shaclConforms || args.text.includes("# SHACL validation result")) {
    return { eligible: false, skipReason: "shacl_nonconformant" };
  }
  return { eligible: true };
}

export function createSession(sessionId?: string): ChatSession {
  return {
    sessionId: sessionId ?? `session_${randomUUID().replace(/-/g, "")}`,
    createdAt: new Date().toISOString(),
    messages: []
  };
}

export function addMessage(session: ChatSession, message: ChatMessage): void {
  session.messages.push(message);
}
