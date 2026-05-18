import Image from "next/image";

import { AgentList } from "@/components/workspace/agent-list";
import { AssistantPanel } from "@/components/workspace/assistant-panel";
import { DomainSelector } from "@/components/workspace/domain-selector";
import { KgTargetPanel } from "@/components/workspace/kg-target-panel";
import { ScriptList } from "@/components/workspace/script-list";
import { WorkspaceLeftSidebarResizable } from "@/components/workspace/workspace-left-sidebar-resizable";
import { WorkspaceRightSidebarResizable } from "@/components/workspace/workspace-right-sidebar-resizable";
import { WorkspaceRunIdChip } from "@/components/workspace/workspace-run-id-chip";
import { WorkspaceScriptRunner } from "@/components/workspace/workspace-script-runner";
import { WorkspaceScriptSessionProvider } from "@/components/workspace/workspace-script-session-context";

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
  scriptsApiUrl: string;
  discoverIntentAgentApiUrl: string;
  a2aMessageSendUrl: string;
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
  scriptsApiUrl,
  discoverIntentAgentApiUrl,
  a2aMessageSendUrl,
  registryConnected,
  kgTargets,
  assistantContext,
  scripts,
}: WorkspaceShellProps) {
  const domainOptions = Array.from(new Set([selectedDomain, ...domains]));
  /** Empty until the user selects a script or types in the draft tab. */
  const draftContent = "";

  const scriptsPayload = scripts.map((script) => ({
    id: script.id,
    name: script.name,
    content: script.content,
  }));

  const scriptRunnerKgTargets = kgTargets.map((target) => ({
    id: target.id,
    displayName: target.displayName,
  }));

  return (
    <main className="workspace-shell">
      <WorkspaceScriptSessionProvider
        draftContent={draftContent}
        scripts={scriptsPayload}
        selectedDomain={selectedDomain}
      >
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
            <WorkspaceRunIdChip />
            <button
              className="workspace-button workspace-top-action-button"
              title={`Signed in as ${username}`}
              type="button"
            >
              About/Help
            </button>
          </div>
        </header>

        <section className="workspace-grid workspace-grid-with-resizable-sidebar">
          <WorkspaceLeftSidebarResizable>
            <aside className="workspace-panel">
              <div className="workspace-panel-tight-stack">
                <DomainSelector domains={domainOptions} selectedDomain={selectedDomain} />
                <ScriptList scriptsApiUrl={scriptsApiUrl} />
              </div>
              <AgentList agents={agents} refreshUrl={agentsRefreshUrl} />
            </aside>
          </WorkspaceLeftSidebarResizable>

          <section className="workspace-panel workspace-editor-panel">
            <div className="workspace-heading-row">
              <h2>Script editor</h2>
              <div className="workspace-stage-row">
                <span className="workspace-chip">Dry-run</span>
                <span className="workspace-chip">Execute</span>
              </div>
            </div>
            <WorkspaceScriptRunner
              a2aMessageSendUrl={a2aMessageSendUrl}
              discoverIntentAgentApiUrl={discoverIntentAgentApiUrl}
              kgTargets={scriptRunnerKgTargets}
              kgTargetsApiBaseUrl={kgTargetsDeleteUrlBase}
              metricNames={assistantContext.metricNames}
              scriptsApiUrl={scriptsApiUrl}
            />
          </section>

          <WorkspaceRightSidebarResizable>
            <KgTargetPanel
              createUrl={kgTargetsCreateUrl}
              deleteUrlBase={kgTargetsDeleteUrlBase}
              selectedDomain={selectedDomain}
              targets={kgTargets}
            />
            <AssistantPanel assistantContext={assistantContext} />
          </WorkspaceRightSidebarResizable>
        </section>
      </WorkspaceScriptSessionProvider>
    </main>
  );
}
