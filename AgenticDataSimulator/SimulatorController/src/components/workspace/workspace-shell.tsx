"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { AboutHelpDialog } from "@/components/workspace/about-help-dialog";
import { AgentList } from "@/components/workspace/agent-list";
import { AgentLlmPreferencesProvider } from "@/components/workspace/agent-llm-preferences-context";
import { AssistantPanel } from "@/components/workspace/assistant-panel";
import { DomainSelector } from "@/components/workspace/domain-selector";
import { IntentsPanel } from "@/components/workspace/intents-panel";
import { KgTargetPanel } from "@/components/workspace/kg-target-panel";
import { MetricStemsPanel } from "@/components/workspace/metric-stems-panel";
import { PrometheusPanel } from "@/components/workspace/prometheus-panel";
import { ToolsPanel } from "@/components/workspace/tools-panel";
import { ScriptList } from "@/components/workspace/script-list";
import { WorkspaceLeftSidebarResizable } from "@/components/workspace/workspace-left-sidebar-resizable";
import { WorkspaceRightSidebarResizable } from "@/components/workspace/workspace-right-sidebar-resizable";
import { WorkspaceScriptRunner } from "@/components/workspace/workspace-script-runner";
import { WorkspaceScriptSessionProvider } from "@/components/workspace/workspace-script-session-context";
import { useWorkspaceInfraConnectionStatus } from "@/components/workspace/use-infra-connection-status";
import { withAppBasePath } from "@/lib/app-paths";

type WorkspaceShellProps = {
  username: string;
  selectedDomain: string;
  domains: string[];
  domainsApiUrl: string;
  agents: Array<{
    name: string;
    isHealthy: boolean | null;
  }>;
  agentsRefreshUrl: string;
  openAiModelsApiUrl: string;
  agentRuntimeLlmApiUrlBase: string;
  kgTargetsCreateUrl: string;
  kgTargetsDeleteUrlBase: string;
  scriptsApiUrl: string;
  runLogsApiUrl: string;
  intentsRegisterUrl: string;
  currentUserId: string;
  discoverIntentAgentApiUrl: string;
  discoverObservationAgentApiUrl: string;
  a2aMessageSendUrl: string;
  previewMetricsApiUrl: string;
  graphDbBaseUrl: string;
  registryConnected: boolean;
  graphDbConnected: boolean;
  prometheusConnected: boolean;
  defaultPrometheusBaseUrl: string;
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

/** Set to true to restore the Agent assistant block in the right sidebar. */
const SHOW_AGENT_ASSISTANT_PANEL = false;

export function WorkspaceShell({
  username,
  selectedDomain,
  domains,
  domainsApiUrl,
  agents,
  agentsRefreshUrl,
  openAiModelsApiUrl,
  agentRuntimeLlmApiUrlBase,
  kgTargetsCreateUrl,
  kgTargetsDeleteUrlBase,
  scriptsApiUrl,
  runLogsApiUrl,
  intentsRegisterUrl,
  currentUserId,
  discoverIntentAgentApiUrl,
  discoverObservationAgentApiUrl,
  a2aMessageSendUrl,
  previewMetricsApiUrl,
  graphDbBaseUrl,
  registryConnected,
  graphDbConnected,
  prometheusConnected,
  defaultPrometheusBaseUrl,
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
  const [availableDomains, setAvailableDomains] = useState(domains);

  useEffect(() => {
    setAvailableDomains(domains);
  }, [domains]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(domainsApiUrl, { cache: "no-store" });
        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as { domains?: string[] };
        const nextDomains = payload.domains ?? [];
        if (nextDomains.length === 0 || cancelled) {
          return;
        }

        setAvailableDomains(nextDomains);
      } catch {
        /* keep SSR/default domains */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [domainsApiUrl]);

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

  const domainOptions = Array.from(new Set([selectedDomain, ...availableDomains]));
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

  const initialInfraStatus = {
    registryConnected,
    graphDbConnected,
    prometheusConnected,
  };

  return (
    <AgentLlmPreferencesProvider>
    <main className="workspace-shell">
      <WorkspaceScriptSessionProvider
        currentUserId={currentUserId}
        defaultGraphDbBaseUrl={graphDbBaseUrl}
        defaultPrometheusBaseUrl={defaultPrometheusBaseUrl}
        draftContent={draftContent}
        runLogsApiUrl={runLogsApiUrl}
        scripts={scriptsPayload}
        selectedDomain={selectedDomain}
      >
        <WorkspaceShellBody
          initialInfraStatus={initialInfraStatus}
          infraStatusApiUrl={infraStatusApiUrl}
          username={username}
          selectedDomain={selectedDomain}
          domainOptions={domainOptions}
          agents={agents}
          agentsRefreshUrl={agentsRefreshUrl}
          openAiModelsApiUrl={openAiModelsApiUrl}
          agentRuntimeLlmApiUrlBase={agentRuntimeLlmApiUrlBase}
          scriptsApiUrl={scriptsApiUrl}
          currentUserId={currentUserId}
          kgTargetsList={kgTargetsList}
          selectedKgTargetId={selectedKgTargetId}
          setSelectedKgTargetId={setSelectedKgTargetId}
          handleKgTargetCreated={handleKgTargetCreated}
          handleKgTargetDeleted={handleKgTargetDeleted}
          kgTargetsCreateUrl={kgTargetsCreateUrl}
          kgTargetsDeleteUrlBase={kgTargetsDeleteUrlBase}
          runLogsApiUrl={runLogsApiUrl}
          intentsRegisterUrl={intentsRegisterUrl}
          discoverIntentAgentApiUrl={discoverIntentAgentApiUrl}
          discoverObservationAgentApiUrl={discoverObservationAgentApiUrl}
          a2aMessageSendUrl={a2aMessageSendUrl}
          previewMetricsApiUrl={previewMetricsApiUrl}
          scriptRunnerKgTargets={scriptRunnerKgTargets}
          scriptRunnerMetricNames={scriptRunnerMetricNames}
          intentsApiUrl={intentsApiUrl}
          intentsUrlBase={intentsUrlBase}
          prometheusClearUrlBase={prometheusClearUrlBase}
          assistantContext={assistantContext}
        />
      </WorkspaceScriptSessionProvider>
    </main>
    </AgentLlmPreferencesProvider>
  );
}

type WorkspaceShellBodyProps = {
  initialInfraStatus: {
    registryConnected: boolean;
    graphDbConnected: boolean;
    prometheusConnected: boolean;
  };
  infraStatusApiUrl: string;
  username: string;
  selectedDomain: string;
  domainOptions: string[];
  agents: WorkspaceShellProps["agents"];
  agentsRefreshUrl: string;
  openAiModelsApiUrl: string;
  agentRuntimeLlmApiUrlBase: string;
  scriptsApiUrl: string;
  currentUserId: string;
  kgTargetsList: KgTargetRecord[];
  selectedKgTargetId: string;
  setSelectedKgTargetId: (id: string) => void;
  handleKgTargetCreated: (target: KgTargetRecord) => void;
  handleKgTargetDeleted: (targetId: string) => void;
  kgTargetsCreateUrl: string;
  kgTargetsDeleteUrlBase: string;
  runLogsApiUrl: string;
  intentsRegisterUrl: string;
  discoverIntentAgentApiUrl: string;
  discoverObservationAgentApiUrl: string;
  a2aMessageSendUrl: string;
  previewMetricsApiUrl: string;
  scriptRunnerKgTargets: Array<{
    id: string;
    displayName: string;
    repositoryId: string;
    graphIri: string;
  }>;
  scriptRunnerMetricNames: string[];
  intentsApiUrl: string;
  intentsUrlBase: string;
  prometheusClearUrlBase: string;
  assistantContext: WorkspaceShellProps["assistantContext"];
};

function WorkspaceShellBody({
  initialInfraStatus,
  infraStatusApiUrl,
  username,
  selectedDomain,
  domainOptions,
  agents,
  agentsRefreshUrl,
  openAiModelsApiUrl,
  agentRuntimeLlmApiUrlBase,
  scriptsApiUrl,
  currentUserId,
  kgTargetsList,
  selectedKgTargetId,
  setSelectedKgTargetId,
  handleKgTargetCreated,
  handleKgTargetDeleted,
  kgTargetsCreateUrl,
  kgTargetsDeleteUrlBase,
  runLogsApiUrl,
  intentsRegisterUrl,
  discoverIntentAgentApiUrl,
  discoverObservationAgentApiUrl,
  a2aMessageSendUrl,
  previewMetricsApiUrl,
  scriptRunnerKgTargets,
  scriptRunnerMetricNames,
  intentsApiUrl,
  intentsUrlBase,
  prometheusClearUrlBase,
  assistantContext,
}: WorkspaceShellBodyProps) {
  const infraStatus = useWorkspaceInfraConnectionStatus(initialInfraStatus, infraStatusApiUrl);
  const [aboutHelpOpen, setAboutHelpOpen] = useState(false);

  return (
    <>
        <AboutHelpDialog open={aboutHelpOpen} onClose={() => setAboutHelpOpen(false)} />
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
            <button
              className="workspace-button workspace-top-action-button"
              onClick={() => setAboutHelpOpen(true)}
              type="button"
            >
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
                agentRuntimeLlmApiUrlBase={agentRuntimeLlmApiUrlBase}
                openAiModelsApiUrl={openAiModelsApiUrl}
                refreshUrl={agentsRefreshUrl}
                registryConnected={infraStatus.registryConnected}
                toolsSlot={
                  <ToolsPanel
                    kgTargets={kgTargetsList}
                    selectedKgTargetId={selectedKgTargetId}
                  />
                }
              />
            </aside>
          </WorkspaceLeftSidebarResizable>

          <section className="workspace-panel workspace-editor-panel">
            <WorkspaceScriptRunner
              a2aMessageSendUrl={a2aMessageSendUrl}
              currentUserId={currentUserId}
              discoverIntentAgentApiUrl={discoverIntentAgentApiUrl}
              discoverObservationAgentApiUrl={discoverObservationAgentApiUrl}
              intentsRegisterUrl={intentsRegisterUrl}
              kgTargets={scriptRunnerKgTargets}
              kgTargetsApiBaseUrl={kgTargetsDeleteUrlBase}
              metricNames={scriptRunnerMetricNames}
              onSelectedKgTargetIdChange={setSelectedKgTargetId}
              previewMetricsApiUrl={previewMetricsApiUrl}
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
            <MetricStemsPanel />
            <div hidden={!SHOW_AGENT_ASSISTANT_PANEL}>
              <AssistantPanel assistantContext={assistantContext} />
            </div>
          </WorkspaceRightSidebarResizable>
        </section>
    </>
  );
}
