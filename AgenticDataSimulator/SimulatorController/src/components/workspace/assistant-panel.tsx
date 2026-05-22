"use client";

import { useMemo } from "react";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";

type AssistantPanelProps = {
  assistantContext: {
    assistantModel: string;
    metricNames: string[];
    promptHints: string[];
    stage: "discovery" | "reporting";
  };
};

export function AssistantPanel({ assistantContext }: AssistantPanelProps) {
  const { scriptExtractedMetricNames } = useWorkspaceScriptSession();

  const derivedMetricLabels = useMemo(
    () =>
      scriptExtractedMetricNames.length > 0 ? scriptExtractedMetricNames : assistantContext.metricNames,
    [assistantContext.metricNames, scriptExtractedMetricNames],
  );

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Agent assistant</h2>
        <span className="workspace-chip">{assistantContext.assistantModel}</span>
      </div>
      <p className="workspace-hint">
        {scriptExtractedMetricNames.length > 0 ? (
          <>
            The AGENT ASSISTANT will use metric names returned by <code>extract metric-catalog</code>{" "}
            in your last Run Script (below). Stage: {assistantContext.stage}.
          </>
        ) : (
          <>
            The AGENT ASSISTANT is using the {assistantContext.stage} stage context and fallback
            derived metric names until you run <code>extract metric-catalog</code> successfully.
          </>
        )}
      </p>
      <div className="workspace-metric-list">
        {derivedMetricLabels.map((metric) => (
          <span className="workspace-chip" key={metric}>
            {metric}
          </span>
        ))}
      </div>
      <label className="workspace-label" htmlFor="assistant-prompt">
        Ask assistant to edit script
      </label>
      <textarea
        className="workspace-textarea"
        defaultValue="Create an observation-report snippet for bandwidth with daily variation and congestion spikes."
        id="assistant-prompt"
        rows={5}
      />
      <div className="workspace-inline-row">
        <button className="workspace-button workspace-button-secondary" type="button">
          Insert patch
        </button>
        <button className="workspace-button" type="button">
          Send
        </button>
      </div>
    </section>
  );
}
