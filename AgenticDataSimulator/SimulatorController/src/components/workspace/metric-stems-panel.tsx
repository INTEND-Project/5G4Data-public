"use client";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";

export function MetricStemsPanel() {
  const { workloadPreviewMetricStems } = useWorkspaceScriptSession();

  if (workloadPreviewMetricStems.length === 0) {
    return null;
  }

  return (
    <section className="workspace-section">
      <h2>Metric stems</h2>
      <div className="workspace-metric-list">
        {workloadPreviewMetricStems.map((stem) => (
          <span className="workspace-chip" key={stem}>
            {stem}
          </span>
        ))}
      </div>
    </section>
  );
}
