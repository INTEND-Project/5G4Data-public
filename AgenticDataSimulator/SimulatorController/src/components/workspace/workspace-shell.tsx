"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { AgentList } from "@/components/workspace/agent-list";
import { AssistantPanel } from "@/components/workspace/assistant-panel";
import { DomainSelector } from "@/components/workspace/domain-selector";
import { IntentsPanel } from "@/components/workspace/intents-panel";
import { KgTargetPanel } from "@/components/workspace/kg-target-panel";
import { PrometheusPanel } from "@/components/workspace/prometheus-panel";
import { ScriptList } from "@/components/workspace/script-list";
import { WorkspaceLeftSidebarResizable } from "@/components/workspace/workspace-left-sidebar-resizable";
import { WorkspaceRightSidebarResizable } from "@/components/workspace/workspace-right-sidebar-resizable";
import { WorkspaceScriptRunner } from "@/components/workspace/workspace-script-runner";
import { WorkspaceScriptSessionProvider } from "@/components/workspace/workspace-script-session-context";
import { useInfraConnectionStatus } from "@/components/workspace/use-infra-connection-status";
import { withAppBasePath } from "@/lib/app-paths";

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
  runLogsApiUrl: string;
  intentsRegisterUrl: string;
  currentUserId: string;
  discoverIntentAgentApiUrl: string;
  discoverObservationAgentApiUrl: string;
  a2aMessageSendUrl: string;
  graphDbBaseUrl: string;
  registryConnected: boolean;
  graphDbConnected: boolean;
  prometheusConnected: boolean;
  intentsApiUrl: string;
  intentsUrlBase: string;
  prometheusClearUrlBase: string;
  infraStatusApiUrl: string;
  kgTargets: Array<{
    id: string;
    displayName: string;
    repositoryId: string;
    graphIri: string;
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
    userId: string;
    shared: boolean;
    lastRunMode: string | null;
    createdAt: Date;
    ownerUsername?: string;
  }>;
};

type KgTargetRecord = {
  id: string;
  displayName: string;
  repositoryId: string;
  graphIri: string;
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
  runLogsApiUrl,
  intentsRegisterUrl,
  currentUserId,
  discoverIntentAgentApiUrl,
  discoverObservationAgentApiUrl,
  a2aMessageSendUrl,
  graphDbBaseUrl,
  registryConnected,
  graphDbConnected,
  prometheusConnected,
  intentsApiUrl,
  intentsUrlBase,
  prometheusClearUrlBase,
  infraStatusApiUrl,
  kgTargets,
  assistantContext,
  scripts,
}: WorkspaceShellProps) {
  const [kgTargetsList, setKgTargetsList] = useState<KgTargetRecord[]>(kgTargets);
  const [selectedKgTargetId, setSelectedKgTargetId] = useState("");

  useEffect(() => {
    setKgTargetsList(kgTargets);
  }, [kgTargets]);

  useEffect(() => {
    if (kgTargetsList.length === 0) {
      setSelectedKgTargetId("");
      return;
    }
    setSelectedKgTargetId((prev) =>
      prev && kgTargetsList.some((t) => t.id === prev) ? prev : kgTargetsList[0].id,
    );
  }, [kgTargetsList]);

  const domainOptions = Array.from(new Set([selectedDomain, ...domains]));
  /** Empty until the user selects a script or types in the draft tab. */
  const draftContent = "";

  const scriptsPayload = useMemo(
    () =>
      scripts.map((script) => ({
        id: script.id,
        name: script.name,
        content: script.content,
        userId: script.userId,
        shared: script.shared,
        createdAt: script.createdAt.toISOString(),
        ownerUsername: script.ownerUsername,
      })),
    [scripts],
  );

  const scriptRunnerKgTargets = useMemo(
    () =>
      kgTargetsList.map((target) => ({
        id: target.id,
        displayName: target.displayName,
        repositoryId: target.repositoryId,
        graphIri: target.graphIri,
      })),
    [kgTargetsList],
  );

  const handleKgTargetCreated = (target: KgTargetRecord) => {
    setKgTargetsList((current) => [target, ...current]);
    setSelectedKgTargetId(target.id);
  };

  const handleKgTargetDeleted = (targetId: string) => {
    setKgTargetsList((current) => {
      const remaining = current.filter((t) => t.id !== targetId);
      setSelectedKgTargetId((prev) =>
        prev !== targetId ? prev : (remaining[0]?.id ?? ""),
      );
      return remaining;
    });
  };

  const scriptRunnerMetricNames = useMemo(
    () => assistantContext.metricNames,
    [assistantContext.metricNames],
  );

  const infraStatus = useInfraConnectionStatus(
    { registryConnected, graphDbConnected, prometheusConnected },
    infraStatusApiUrl,
  );

  return (
    <main className="workspace-shell">
      <WorkspaceScriptSessionProvider
        draftContent={draftContent}
        runLogsApiUrl={runLogsApiUrl}
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
            <button className="workspace-button workspace-top-action-button" type="button">
              About/Help
            </button>
            <div className="workspace-user-controls">
              <span className="workspace-user-label">User:</span>
              <span
                className="workspace-chip workspace-topbar-chip workspace-user-chip"
                title={`Signed in as ${username}`}
              >
                {username}
              </span>
              <form action={withAppBasePath("/api/auth/logout")} method="post">
                <button className="workspace-button workspace-top-action-button" type="submit">
                  Logout
                </button>
              </form>
            </div>
          </div>
        </header>

        <section className="workspace-grid workspace-grid-with-resizable-sidebar">
          <WorkspaceLeftSidebarResizable>
            <aside className="workspace-panel">
              <div className="workspace-panel-tight-stack">
                <DomainSelector domains={domainOptions} selectedDomain={selectedDomain} />
                <ScriptList currentUserId={currentUserId} scriptsApiUrl={scriptsApiUrl} />
              </div>
              <AgentList
                agents={agents}
                refreshUrl={agentsRefreshUrl}
                registryConnected={infraStatus.registryConnected}
              />
            </aside>
          </WorkspaceLeftSidebarResizable>

          <section className="workspace-panel workspace-editor-panel">
            <WorkspaceScriptRunner
              a2aMessageSendUrl={a2aMessageSendUrl}
              currentUserId={currentUserId}
              discoverIntentAgentApiUrl={discoverIntentAgentApiUrl}
              discoverObservationAgentApiUrl={discoverObservationAgentApiUrl}
              graphDbBaseUrl={graphDbBaseUrl}
              intentsRegisterUrl={intentsRegisterUrl}
              kgTargets={scriptRunnerKgTargets}
              kgTargetsApiBaseUrl={kgTargetsDeleteUrlBase}
              metricNames={scriptRunnerMetricNames}
              onSelectedKgTargetIdChange={setSelectedKgTargetId}
              scriptsApiUrl={scriptsApiUrl}
              selectedKgTargetId={selectedKgTargetId}
            />
          </section>

          <WorkspaceRightSidebarResizable>
            <KgTargetPanel
              createUrl={kgTargetsCreateUrl}
              deleteUrlBase={kgTargetsDeleteUrlBase}
              graphDbConnected={infraStatus.graphDbConnected}
              onTargetCreated={handleKgTargetCreated}
              onTargetDeleted={handleKgTargetDeleted}
              selectedDomain={selectedDomain}
              targets={kgTargetsList}
              username={username}
            />
            <PrometheusPanel prometheusConnected={infraStatus.prometheusConnected} />
            <IntentsPanel
              graphDbConnected={infraStatus.graphDbConnected}
              intentsApiUrl={intentsApiUrl}
              intentsUrlBase={intentsUrlBase}
              prometheusClearUrlBase={prometheusClearUrlBase}
              prometheusConnected={infraStatus.prometheusConnected}
              selectedDomain={selectedDomain}
            />
            <AssistantPanel assistantContext={assistantContext} />
          </WorkspaceRightSidebarResizable>
        </section>
      </WorkspaceScriptSessionProvider>
    </main>
  );
}
