import Image from "next/image";

import { AgentList } from "@/components/workspace/agent-list";
import { AssistantPanel } from "@/components/workspace/assistant-panel";
import { ScriptEditor } from "@/components/editor/script-editor";
import { DomainSelector } from "@/components/workspace/domain-selector";
import { KgTargetPanel } from "@/components/workspace/kg-target-panel";
import { ScriptList } from "@/components/workspace/script-list";

type WorkspaceShellProps = {
  username: string;
  selectedDomain: string;
  domains: string[];
  agents: Array<{
    name: string;
    isHealthy: boolean | null;
  }>;
  agentsRefreshUrl: string;
  kgTargetsCreateUrl: string;
  kgTargetsDeleteUrlBase: string;
  registryConnected: boolean;
  kgTargets: Array<{
    id: string;
    displayName: string;
    repositoryId: string;
  }>;
  assistantContext: {
    assistantModel: string;
    metricNames: string[];
    promptHints: string[];
    stage: "discovery" | "reporting";
  };
  scripts: Array<{
    id: string;
    name: string;
    content: string;
    lastRunMode: string | null;
  }>;
};

export function WorkspaceShell({
  username,
  selectedDomain,
  domains,
  agents,
  agentsRefreshUrl,
  kgTargetsCreateUrl,
  kgTargetsDeleteUrlBase,
  registryConnected,
  kgTargets,
  assistantContext,
  scripts,
}: WorkspaceShellProps) {
  const domainOptions = Array.from(new Set([selectedDomain, ...domains]));
  const scriptSummaries = scripts.map((script, index) => ({
    name: script.name,
    detail:
      script.lastRunMode === null
        ? "Never run • ready for stage 1 authoring"
        : `Last run mode: ${script.lastRunMode}`,
    active: index === 0,
  }));
  const activeScript = scripts[0];
  const runTargetOptions =
    kgTargets.length > 0
      ? kgTargets.map((target) => target.displayName)
      : ["kg-avalanche-demo"];
  const editorValue =
    activeScript?.content ??
    `discover intent-agent by domain ${selectedDomain} as intentGen
create intent using intentGen prompt "Deploy avalanche object detection" as avalancheIntent
extract metric-catalog for avalancheIntent as avalancheMetrics
discover observation-agent by domain ${selectedDomain} as observationControl
request observation-report using observationControl for avalancheIntent instructions "For metric bandwidth use daily variation and congestion spikes." as avalancheObservationSession`;

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-brand">
          <Image
            alt="INTEND icon"
            className="workspace-brand-logo"
            src="https://intendproject.eu/intend-icon.png"
            height={44}
            width={44}
          />
          <div className="workspace-brand-copy">
            <strong>INTEND Data Generation Controller Studio</strong>
            <span>TM Forum intent data generation script design and execution for cognitive continuum</span>
          </div>
        </div>
        <div className="workspace-top-actions">
          <span
            className={`workspace-chip workspace-topbar-chip ${
              registryConnected ? "workspace-chip-live" : "workspace-chip-down"
            }`}
          >
            {registryConnected ? "agent registry connected" : "agent registry disconnected"}
          </span>
          <span className="workspace-chip workspace-topbar-chip">runId: demo-run-2026-05-06</span>
          <button
            className="workspace-button workspace-top-action-button"
            title={`Signed in as ${username}`}
            type="button"
          >
            About/Help
          </button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="workspace-panel">
          <div className="workspace-panel-tight-stack">
            <DomainSelector domains={domainOptions} selectedDomain={selectedDomain} />
            <ScriptList scripts={scriptSummaries} />
          </div>
          <AgentList agents={agents} refreshUrl={agentsRefreshUrl} />
        </aside>

        <section className="workspace-panel workspace-editor-panel">
          <div className="workspace-heading-row">
            <h2>Script editor</h2>
            <div className="workspace-stage-row">
              <span className="workspace-chip">Dry-run</span>
              <span className="workspace-chip">Execute</span>
            </div>
          </div>
          <div className="workspace-editor-stage">
            <h3>Stage 1</h3>
            <p>Discover domain agents, create the intent, and extract the metric catalog.</p>
          </div>
          <div className="workspace-editor-stage">
            <h3>Stage 2</h3>
            <p>
              Request status and observation reports over all or selected metrics with
              timing and shape constraints.
            </p>
          </div>
          <ScriptEditor
            metricNames={assistantContext.metricNames}
            value={editorValue}
          />
          <div className="workspace-runner">
            <div className="workspace-runner-field">
              <label className="workspace-label">Run mode</label>
              <div className="workspace-runner-modes">
                <span className="workspace-runner-mode workspace-runner-mode-active">
                  dry-run
                </span>
                <span className="workspace-runner-mode">execute</span>
              </div>
            </div>
            <div className="workspace-runner-field">
              <label className="workspace-label" htmlFor="runner-kg-target">
                Knowledge graph target
              </label>
              <select
                className="workspace-select workspace-runner-select"
                defaultValue={runTargetOptions[0]}
                id="runner-kg-target"
              >
                {runTargetOptions.map((targetName) => (
                  <option key={targetName} value={targetName}>
                    {targetName}
                  </option>
                ))}
              </select>
            </div>
            <div className="workspace-runner-field">
              <label className="workspace-label" htmlFor="runner-result-policy">
                Run result policy
              </label>
              <select
                className="workspace-select workspace-runner-select"
                defaultValue="stop on first error"
                id="runner-result-policy"
              >
                <option value="stop on first error">stop on first error</option>
                <option value="continue with warnings">continue with warnings</option>
              </select>
            </div>
            <button className="workspace-button workspace-runner-button" type="button">
              Run Script
            </button>
          </div>
        </section>

        <aside className="workspace-panel">
          <KgTargetPanel
            createUrl={kgTargetsCreateUrl}
            deleteUrlBase={kgTargetsDeleteUrlBase}
            selectedDomain={selectedDomain}
            targets={kgTargets}
          />
          <AssistantPanel assistantContext={assistantContext} />
        </aside>
      </section>
    </main>
  );
}
