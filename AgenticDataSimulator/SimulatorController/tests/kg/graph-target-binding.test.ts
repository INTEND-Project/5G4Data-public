import { describe, expect, it } from "vitest";

import {
  buildGraphTargetBinding,
  hasSimulatorMetadataFields,
  simulatorMetadataEnvelope,
} from "../../src/lib/kg/graph-target-binding";

describe("graph-target-binding", () => {
  it("builds SPARQL endpoint and repository base URL", () => {
    const binding = buildGraphTargetBinding(
      {
        id: "target-1",
        repositoryId: "telenor-demo",
        graphIri: "urn:intend:kg:demo",
        displayName: "Demo",
      },
      "http://graphdb:7200/",
    );

    expect(binding).toEqual({
      graphTargetId: "target-1",
      repositoryId: "telenor-demo",
      graphIri: "urn:intend:kg:demo",
      sparqlEndpoint: "http://graphdb:7200/repositories/telenor-demo/sparql",
      repositoryBaseUrl: "http://graphdb:7200/repositories/telenor-demo",
    });
  });

  it("wraps llm settings in simulator metadata envelope v1", () => {
    expect(
      simulatorMetadataEnvelope({
        llmModel: "codestral:latest",
        llmApiBaseUrl: "http://spark-88e2.taile6732f.ts.net:11434/v1",
        temperature: 0.25,
      }),
    ).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        llmModel: "codestral:latest",
        llmApiBaseUrl: "http://spark-88e2.taile6732f.ts.net:11434/v1",
        temperature: 0.25,
      },
    });
  });

  it("wraps llmProvider in simulator metadata envelope v1", () => {
    expect(
      simulatorMetadataEnvelope({
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-5",
        llmApiBaseUrl: "https://api.anthropic.com",
        temperature: 0.5,
      }),
    ).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-5",
        llmApiBaseUrl: "https://api.anthropic.com",
        temperature: 0.5,
      },
    });
  });

  it("wraps reportingIntervalMinutes in simulator metadata envelope v1", () => {
    expect(simulatorMetadataEnvelope({ reportingIntervalMinutes: 15 })).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        reportingIntervalMinutes: 15,
      },
    });
  });

  it("wraps reportingIntervalSeconds in simulator metadata envelope v1", () => {
    expect(simulatorMetadataEnvelope({ reportingIntervalSeconds: 60 })).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        reportingIntervalSeconds: 60,
      },
    });
  });

  it("wraps observation status settings in simulator metadata envelope v1", () => {
    expect(
      simulatorMetadataEnvelope({
        observationRetentionWindow: "5m",
        intentStatusReportsEnabled: true,
        intentStatusBootstrapCompliantDelay: "1m",
      }),
    ).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        observationRetentionWindow: "5m",
        intentStatusReportsEnabled: true,
        intentStatusBootstrapCompliantDelay: "1m",
      },
    });
    expect(
      hasSimulatorMetadataFields({
        intentStatusReportsEnabled: false,
      }),
    ).toBe(true);
  });

  it("wraps system prompt, few-shots, numCtx, and stop sequences", () => {
    expect(
      simulatorMetadataEnvelope({
        systemPrompt: "Emit Turtle.",
        fewShotMessages: [{ role: "user", content: "hi" }],
        numCtx: 12288,
        stopSequences: ["</s>", "<|eot_id|>"],
      }),
    ).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        systemPrompt: "Emit Turtle.",
        fewShotMessages: [{ role: "user", content: "hi" }],
        numCtx: 12288,
        stopSequences: ["</s>", "<|eot_id|>"],
      },
    });
  });

  it("wraps binding in simulator metadata envelope v1", () => {
    const binding = buildGraphTargetBinding(
      { id: "t", repositoryId: "r", graphIri: "urn:g" },
      "http://host:7200",
    );
    expect(simulatorMetadataEnvelope({ graphTarget: binding })).toEqual({
      simulator: {
        controllerBindingVersion: "1",
        graphTarget: binding,
      },
    });
  });
});
