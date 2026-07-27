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
  const { scriptExtractedMetricNames, workloadPreviewMetricStems } = useWorkspaceScriptSession();

  const derivedMetricLabels = useMemo(() => {
    if (scriptExtractedMetricNames.length > 0) {
      return scriptExtractedMetricNames;
    }
    if (workloadPreviewMetricStems.length > 0) {
      return workloadPreviewMetricStems;
    }
    return assistantContext.metricNames;
  }, [assistantContext.metricNames, scriptExtractedMetricNames, workloadPreviewMetricStems]);

  const metricSourceHint = useMemo(() => {
    if (scriptExtractedMetricNames.length > 0) {
      return (
        <>
          The AGENT ASSISTANT will use metric names returned by <code>extract metric-catalog</code>{" "}
          in your last Run Script (below). Stage: {assistantContext.stage}.
        </>
      );
    }
    if (workloadPreviewMetricStems.length > 0) {
      return (
        <>
          The AGENT ASSISTANT will use metric stems from your last <strong>Show metrics</strong>{" "}
          preview (workload catalogue). Stage: {assistantContext.stage}.
        </>
      );
    }
    return (
      <>
        The AGENT ASSISTANT is using the {assistantContext.stage} stage context. Run{" "}
        <code>extract metric-catalog</code> in a script or use <strong>Show metrics</strong> to load
        metric names.
      </>
    );
  }, [
    assistantContext.stage,
    scriptExtractedMetricNames.length,
    workloadPreviewMetricStems.length,
  ]);

  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Agent assistant</h2>
        <span className="workspace-chip">{assistantContext.assistantModel}</span>
      </div>
      <p className="workspace-hint">{metricSourceHint}</p>
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
        defaultValue="Create an observation-report snippet with daily variation and congestion spikes for a metric from the catalog."
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
