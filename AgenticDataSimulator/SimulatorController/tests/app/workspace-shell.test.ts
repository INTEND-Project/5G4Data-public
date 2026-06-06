import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workspace shell bootstrap", () => {
  it("defines login and workspace pages with OpenClaw-specific copy", () => {
    const loginSource = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const workspaceSource = readFileSync(
      resolve(process.cwd(), "src/app/workspace/page.tsx"),
      "utf8",
    );
    const shellSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-shell.tsx"),
      "utf8",
    );
    const runIdChipSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-run-id-chip.tsx"),
      "utf8",
    );
    const scriptSessionContextSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-script-session-context.tsx"),
      "utf8",
    );
    const scriptRunnerSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-script-runner.tsx"),
      "utf8",
    );
    const agentListSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/agent-list.tsx"),
      "utf8",
    );
    const scriptListSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/script-list.tsx"),
      "utf8",
    );
    const toolsPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/tools-panel.tsx"),
      "utf8",
    );
    const collapsibleSectionSource = readFileSync(
      resolve(
        process.cwd(),
        "src/components/workspace/workspace-collapsible-section.tsx",
      ),
      "utf8",
    );
    const domainSelectorSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/domain-selector.tsx"),
      "utf8",
    );
    const kgTargetPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/kg-target-panel.tsx"),
      "utf8",
    );
    const prometheusPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/prometheus-panel.tsx"),
      "utf8",
    );
    const workloadsPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workloads-panel.tsx"),
      "utf8",
    );
    const intentsPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/intents-panel.tsx"),
      "utf8",
    );
    const storageIconsSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-storage-icons.tsx"),
      "utf8",
    );
    const globalsSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(loginSource).toContain("Sign in to Controller Studio");
    expect(loginSource).toContain('withAppBasePath("/api/auth/login")');
    expect(loginSource).toContain('withAppBasePath("/api/auth/register")');
    expect(workspaceSource).toContain("WorkspaceShell");
    expect(workspaceSource).not.toContain("getInfraConnectionStatus");
    expect(workspaceSource).not.toContain("listNormalizedAgents");
    expect(workspaceSource).toContain("domainsApiUrl");
    expect(shellSource).toContain("domainsApiUrl");
    expect(workspaceSource).toContain("infraStatusApiUrl");
    expect(workspaceSource).toContain('withAppBasePath("/api/infra/status")');
    expect(workspaceSource).toContain("registryConnected");
    expect(workspaceSource).toContain("graphDbConnected");
    expect(workspaceSource).toContain("prometheusConnected");
    expect(workspaceSource).toContain("workloadCatalogConnected");
    expect(workspaceSource).toContain("defaultPrometheusBaseUrl={appEnv.prometheusUrl}");
    expect(workspaceSource).toContain("defaultWorkloadCatalogBaseUrl={appEnv.workloadCatalogBaseUrl}");
    expect(workspaceSource).toContain("graphDbBaseUrl={appEnv.graphDbBaseUrl}");
    expect(workspaceSource).toContain('withAppBasePath("/api/intents")');
    expect(workspaceSource).toContain('withAppBasePath("/api/prometheus/intents")');
    expect(workspaceSource).toContain("kgTargetsCreateUrl");
    expect(workspaceSource).toContain("kgTargetsDeleteUrlBase");
    expect(workspaceSource).toContain('withAppBasePath("/api/kg-targets")');
    expect(workspaceSource).toContain('withAppBasePath("/api/scripts")');
    expect(shellSource).not.toContain("INTEND Controller");
    expect(shellSource).not.toContain("OpenClaw Workspace");
    expect(shellSource).toContain("registryConnected");
    expect(shellSource).toContain("INTEND Integration and Data Generation Controller Studio");
    expect(shellSource).toContain(
      "TM Forum intent data generation script design and execution for cognitive continuum",
    );
    expect(shellSource).toContain("intend-icon.png");
    expect(shellSource).not.toContain("agent registry connected");
    expect(shellSource).not.toContain("agent registry disconnected");
    expect(shellSource).toContain("useWorkspaceInfraConnectionStatus");
    expect(shellSource).toContain("infraStatusApiUrl");
    expect(shellSource).toContain("infraStatus.registryConnected");
    expect(shellSource).not.toContain("WorkspaceRunIdChip");
    expect(runIdChipSource).toContain("formatScriptRunListLabel");
    expect(runIdChipSource).toContain("workspace-script-run-select");
    expect(scriptRunnerSource).toContain("WorkspaceRunIdChip");
    expect(scriptRunnerSource).toContain("workspace-editor-toolbar");
    expect(scriptRunnerSource).not.toContain("Run mode");
    expect(scriptRunnerSource).toContain("analyzeScript");
    expect(scriptRunnerSource).not.toContain("Run result policy");
    expect(runIdChipSource).toContain("scriptRunLogs");
    expect(runIdChipSource).toContain("deleteSelectedScriptRunLog");
    expect(runIdChipSource).toContain("deleteAllScriptRunLogs");
    expect(scriptSessionContextSource).toContain("window.confirm");
    expect(scriptSessionContextSource).toContain("slice(0, 10)");
    expect(shellSource).toContain("About/Help");
    expect(shellSource).toContain("AboutHelpDialog");
    expect(shellSource).toContain("aboutHelpOpen");
    expect(shellSource).toContain("setAboutHelpOpen");
    expect(shellSource).toContain("workspace-user-controls");
    expect(shellSource).toContain("workspace-user-label");
    expect(shellSource).toContain("User:");
    expect(shellSource).toContain("Logout");
    expect(shellSource).toContain('withAppBasePath("/api/auth/logout")');
    expect(shellSource).toContain("workspace-user-chip");
    expect(shellSource).toContain("{username}");
    expect(shellSource).toContain("workspace-topbar-chip");
    expect(shellSource).toContain("workspace-panel-tight-stack");
    expect(shellSource).toContain("kgTargetsCreateUrl");
    expect(shellSource).toContain("kgTargetsDeleteUrlBase");
    expect(shellSource).toContain("kgTargetsList");
    expect(shellSource).toContain("selectedKgTargetId");
    expect(shellSource).toContain("handleKgTargetCreated");
    expect(shellSource).toContain("handleKgTargetDeleted");
    expect(shellSource).toContain("onSelectedKgTargetIdChange");
    expect(shellSource).toContain("PrometheusPanel");
    expect(shellSource).toContain("IntentsPanel");
    expect(shellSource).toContain("prometheusConnected");
    expect(shellSource).toContain("intentsApiUrl");
    expect(shellSource).toContain("intentsUrlBase");
    expect(shellSource).toContain("prometheusClearUrlBase");
    expect(shellSource).toContain("scriptsApiUrl");
    expect(shellSource).toContain("WorkspaceScriptSessionProvider");
    expect(shellSource).toContain("defaultPrometheusBaseUrl={defaultPrometheusBaseUrl}");
    expect(shellSource).toContain("defaultGraphDbBaseUrl={graphDbBaseUrl}");
    expect(shellSource).toContain("currentUserId={currentUserId}");
    expect(shellSource).toContain("WorkspaceLeftSidebarResizable");
    expect(shellSource).toContain("WorkspaceRightSidebarResizable");
    expect(scriptRunnerSource).toContain("Knowledge graph target");
    expect(scriptRunnerSource).toContain("selectedKgTargetId");
    expect(scriptRunnerSource).toContain("onSelectedKgTargetIdChange");
    expect(scriptRunnerSource).toContain("Create a KG first");
    expect(scriptRunnerSource).toContain("hasKgTarget");
    expect(scriptRunnerSource).toContain("kgRequiredDialogOpen");
    expect(scriptRunnerSource).toContain("storageDeletionInProgress");
    expect(scriptRunnerSource).toContain("storageDeletionDialogOpen");
    expect(scriptRunnerSource).toContain("backgroundGenerationDialogOpen");
    expect(scriptRunnerSource).toContain("Observation generation running in background");
    expect(scriptRunnerSource).toContain("observation data is ready");
    expect(scriptRunnerSource).toContain("markIntentAwaitingObservation(canonicalId)");
    expect(scriptRunnerSource).not.toContain("autoCloseAfterFirstAgentReply");
    expect(scriptRunnerSource).toContain("reused until you Close");
    expect(scriptSessionContextSource).toContain("syncActiveRunLinesToList()");
    expect(scriptRunnerSource).toContain("AbortSignal.timeout(120_000)");
    expect(scriptRunnerSource).toContain("Storage deletion in progress");
    expect(scriptRunnerSource).toContain("Knowledge graph required");
    expect(scriptRunnerSource).toContain('role="alertdialog"');
    expect(scriptRunnerSource).toContain(
      "Create a knowledge graph target in the KG target panel before running scripts.",
    );
    expect(scriptRunnerSource).not.toContain("kg-avalanche-demo");
    expect(scriptRunnerSource).not.toContain("continue with warnings");
    expect(scriptRunnerSource).toContain("Run Script");
    expect(scriptRunnerSource).toContain("WorkspaceRunLogDialog");
    const runLogDialogSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/workspace-run-log-dialog.tsx"),
      "utf8",
    );
    expect(runLogDialogSource).toContain("selectedRunLogLines");
    expect(scriptSessionContextSource).toContain("scheduleLiveRunLogRevision");
    expect(scriptSessionContextSource).toContain("beginStorageDeletion");
    expect(scriptSessionContextSource).toContain("endStorageDeletion");
    expect(scriptSessionContextSource).toContain("storageDeletionInProgress");
    expect(scriptSessionContextSource).toContain("WorkspaceRunLogUiContext");
    expect(scriptRunnerSource).toContain("Save As");
    expect(scriptRunnerSource).toContain("Show metrics");
    expect(scriptRunnerSource).toContain("ShowMetricsDialog");
    expect(scriptRunnerSource).toContain("findCreateIntentStatements");
    expect(workspaceSource).toContain("previewMetricsApiUrl");
    expect(workspaceSource).toContain("/api/workload-catalogue/preview-metrics");
    expect(scriptRunnerSource).toContain("workspace-editor-height-resizer");
    expect(scriptRunnerSource).toContain("workspace-editor-tabs");
    expect(scriptRunnerSource).toContain("role=\"tablist\"");
    expect(workspaceSource).toContain("agentsRefreshUrl");
    expect(workspaceSource).not.toContain('refresh: "1"');
    expect(agentListSource).toContain("forceRefresh: !registryConnectedRef.current");
    expect(agentListSource).toContain("Available agents");
    expect(agentListSource).toContain("registered");
    expect(agentListSource).toContain("AgentHealthIcon");
    expect(agentListSource).toContain("workspace-agent-health-icon");
    expect(agentListSource).toContain("workspace-agent-registry-chip");
    expect(agentListSource).toContain("registryConnected");
    expect(agentListSource).not.toContain("registeredAgentCount");
    expect(agentListSource).toContain("registryPollIntervalMs");
    expect(agentListSource).toContain("refreshAgents");
    expect(agentListSource).toContain("fetch(`${requestUrl.pathname}${requestUrl.search}`");
    expect(agentListSource).not.toContain("Refreshing...");
    expect(agentListSource).toContain("setDisplayedAgents");
    expect(agentListSource).toContain("isHealthy === false");
    expect(agentListSource).toContain("workspace-partner-grid");
    expect(agentListSource).toContain("WorkspaceCollapsibleSection");
    expect(agentListSource).toContain('sectionId="agents"');
    expect(agentListSource).not.toContain('<div className="workspace-section">');
    expect(scriptListSource).toContain("WorkspaceCollapsibleSection");
    expect(scriptListSource).toContain('sectionId="scripts"');
    expect(toolsPanelSource).toContain("WorkspaceCollapsibleSection");
    expect(toolsPanelSource).toContain('sectionId="tools"');
    expect(collapsibleSectionSource).toContain("aria-expanded");
    expect(collapsibleSectionSource).toContain("localStorage");
    expect(collapsibleSectionSource).toContain("openclaw-workspace-section-");
    expect(domainSelectorSource).not.toContain("WorkspaceCollapsibleSection");
    expect(domainSelectorSource).toContain("workspace-section-title");
    expect(globalsSource).toContain(".workspace-collapsible-trigger");
    expect(globalsSource).toContain(".workspace-collapsible-chevron-expanded");
    expect(domainSelectorSource).toContain("workspace-select-compact");
    expect(domainSelectorSource).toContain("workspace-section-compact");
    expect(domainSelectorSource).toContain("workspace-section-domain");
    expect(domainSelectorSource).toContain("workspace-select-tight");
    expect(kgTargetPanelSource).toContain('"use client"');
    expect(kgTargetPanelSource).toContain('useState(defaultKgNameSuffix)');
    expect(kgTargetPanelSource).toContain("buildKgNamePrefix");
    expect(kgTargetPanelSource).toContain("workspace-share-as-prefix");
    expect(kgTargetPanelSource).not.toContain('useState("kg-avalanche-demo")');
    expect(kgTargetPanelSource).toContain("fetch(createUrl");
    expect(kgTargetPanelSource).toContain("onTargetCreated");
    expect(kgTargetPanelSource).toContain("onTargetDeleted");
    expect(kgTargetPanelSource).not.toContain("setDisplayedTargets");
    expect(kgTargetPanelSource).toContain("selectedDomain");
    expect(kgTargetPanelSource).toContain("window.confirm");
    expect(kgTargetPanelSource).toContain("beginStorageDeletion");
    expect(kgTargetPanelSource).toContain("endStorageDeletion");
    expect(kgTargetPanelSource).toContain("workspaceInfraUrlParams");
    expect(kgTargetPanelSource).toContain("prometheusBaseUrl");
    expect(kgTargetPanelSource).toContain("/empty${query");
    expect(kgTargetPanelSource).toContain('method: "POST"');
    expect(kgTargetPanelSource).toContain('method: "DELETE"');
    expect(kgTargetPanelSource).toContain("Emptying...");
    expect(kgTargetPanelSource).toContain("Deleting...");
    expect(kgTargetPanelSource).toContain('aria-label={`Empty ${target.repositoryId}`}');
    expect(kgTargetPanelSource).toContain('aria-label={`Delete ${target.repositoryId}`}');
    expect(kgTargetPanelSource).toContain("/api/graphdb/status");
    expect(kgTargetPanelSource).not.toContain("graphDbHealthCheckUrl");
    expect(kgTargetPanelSource).toContain("graphdb-base-url");
    expect(kgTargetPanelSource).toContain("Use server default");
    expect(kgTargetPanelSource).toContain("showCustomChip ? customReachable : graphDbConnected");
    expect(kgTargetPanelSource).not.toContain("Empty KG removes all triples");
    expect(kgTargetPanelSource).not.toContain("Delete repo removes the GraphDB repository");
    expect(prometheusPanelSource).toContain('"use client"');
    expect(prometheusPanelSource).toContain("/api/prometheus/status");
    expect(prometheusPanelSource).not.toContain("prometheusHealthCheckUrl");
    expect(prometheusPanelSource).toContain("Prometheus base URL");
    expect(prometheusPanelSource).toContain("prometheus-base-url");
    expect(prometheusPanelSource).toContain("useWorkspaceScriptSession");
    expect(prometheusPanelSource).toContain("Use server default");
    expect(prometheusPanelSource).toContain("workspace-chip-live");
    expect(prometheusPanelSource).toContain("workspace-chip-down");
    expect(prometheusPanelSource).toContain("showCustomChip ? customReachable : prometheusConnected");
    expect(prometheusPanelSource).not.toContain("workspace-intent-id-label");
    expect(shellSource).toContain("WorkloadsPanel");
    expect(shellSource).toContain("workloadCatalogConnected={infraStatus.workloadCatalogConnected}");
    expect(workloadsPanelSource).toContain("WorkspaceCollapsibleSection");
    expect(workloadsPanelSource).toContain('sectionId="workloads"');
    expect(workloadsPanelSource).toContain('title="Workloads"');
    expect(workloadsPanelSource).toContain("headerEnd={reachabilityChip}");
    expect(workloadsPanelSource).toContain("/api/workload-catalogue/status");
    expect(workloadsPanelSource).toContain("/api/workload-catalogue/charts");
    expect(workloadsPanelSource).toContain("workload-catalog-base-url");
    expect(workloadsPanelSource).toContain("Use server default");
    expect(workloadsPanelSource).toContain("showCustomChip ? customReachable === true : workloadCatalogConnected");
    expect(scriptSessionContextSource).toContain("defaultWorkloadCatalogBaseUrl");
    expect(scriptSessionContextSource).toContain("workloadCatalogBaseUrl");
    expect(scriptSessionContextSource).toContain("simulator-controller:workload-catalog-base-url:");
    expect(scriptSessionContextSource).toContain("defaultPrometheusBaseUrl");
    expect(scriptSessionContextSource).toContain("prometheusBaseUrl");
    expect(scriptSessionContextSource).toContain("simulator-controller:prometheus-base-url:");
    expect(scriptSessionContextSource).toContain("defaultGraphDbBaseUrl");
    expect(scriptSessionContextSource).toContain("graphDbBaseUrl");
    expect(scriptSessionContextSource).toContain("simulator-controller:graphdb-base-url:");
    expect(intentsPanelSource).toContain('params.set("prometheusBaseUrl"');
    expect(intentsPanelSource).toContain('params.set("graphDbBaseUrl"');
    expect(intentsPanelSource).toContain('"use client"');
    expect(intentsPanelSource).toContain("<h2>Intents</h2>");
    expect(intentsPanelSource).toContain("workspace-intent-id-label");
    expect(intentsPanelSource).toContain("workspace-card-intent");
    expect(intentsPanelSource).toContain("workspace-card-intent--${cardStatus}");
    expect(intentsPanelSource).toContain("grafanaReady");
    expect(globalsSource).toContain(".workspace-card-intent");
    expect(globalsSource).toContain(".workspace-card-intent--pending");
    expect(globalsSource).toContain(".workspace-card-intent--ready");
    expect(globalsSource).toContain("container-name: intent-card");
    expect(intentsPanelSource).toContain("DeleteStorageIcon");
    expect(intentsPanelSource).toContain("GrafanaIcon");
    expect(intentsPanelSource).toContain("/description");
    expect(intentsPanelSource).toContain("/empty-graphdb");
    expect(intentsPanelSource).toContain("beginStorageDeletion");
    expect(intentsPanelSource).toContain("endStorageDeletion");
    expect(intentsPanelSource).toContain("Deleting {deletingIntentId}");
    expect(intentsPanelSource).toContain("deletingIntentId !== null");
    expect(intentsPanelSource).toContain("intentsEqual");
    expect(intentsPanelSource).toContain("initialScriptRunIdRef");
    expect(intentsPanelSource).toContain("workspace-panel-refresh-button");
    expect(intentsPanelSource).toContain("Refresh intent list");
    expect(intentsPanelSource).not.toContain("INTENT_LITE_POLL_MS");
    expect(storageIconsSource).toContain("workspace-icon-badge-button");
    expect(storageIconsSource).toContain("/icons/prometheus.svg");
    expect(storageIconsSource).toContain("/icons/graphdb.svg");
    expect(storageIconsSource).toContain("/icons/grafana.svg");
    expect(kgTargetPanelSource).not.toContain(
      "Repository and named graph creation will be wired to GraphDB in the next task.",
    );
    expect(globalsSource).toContain(".workspace-icon-badge-button");
    expect(globalsSource).toContain(".workspace-icon-badge");
    expect(globalsSource).toContain(".workspace-select-compact");
    expect(globalsSource).toContain(".workspace-section-compact");
    expect(globalsSource).toContain(".workspace-section-domain");
    expect(globalsSource).toContain(".workspace-panel-tight-stack");
    expect(globalsSource).toContain(".workspace-select-tight");
    expect(globalsSource).toContain(".workspace-section-title");
    expect(globalsSource).toContain("align-content: start;");
    expect(globalsSource).toContain("display: flex;");
    expect(globalsSource).toContain("flex-direction: column;");
    expect(globalsSource).toContain("align-items: flex-start;");
    expect(globalsSource).toContain("height: 44px;");
    expect(globalsSource).toContain("gap: 0;");
    expect(globalsSource).toContain(".workspace-dot-down");
    expect(globalsSource).toContain(".workspace-dot-unknown");
    expect(globalsSource).toContain("flex: 0 0 10px;");
    expect(globalsSource).toContain("min-width: 10px;");
    expect(globalsSource).toContain(".workspace-partner-grid");
    expect(globalsSource).toContain(".workspace-partner-tile");
    expect(globalsSource).toContain(".workspace-partner-logo");
    expect(globalsSource).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(globalsSource).toContain("background: #ffffff;");
    expect(globalsSource).toContain("border-radius:");
    expect(globalsSource).toContain("padding:");
    expect(globalsSource).toContain("max-height:");
    expect(globalsSource).toContain("object-fit: contain;");
    expect(globalsSource).toContain(".workspace-brand");
    expect(globalsSource).toContain(".workspace-brand-logo");
    expect(globalsSource).toContain(".workspace-brand-copy");
    expect(globalsSource).toContain(".workspace-top-actions");
    expect(globalsSource).toContain(".workspace-topbar-chip");
    expect(globalsSource).toContain(".workspace-user-chip");
    expect(globalsSource).toContain(".workspace-user-controls");
    expect(globalsSource).toContain(".workspace-user-label");
    expect(globalsSource).toContain(".workspace-run-history-controls");
    expect(globalsSource).toContain("select.workspace-script-run-select");
    expect(globalsSource).toContain(".workspace-editor-toolbar");
    expect(globalsSource).toContain(".workspace-chip-live");
    expect(globalsSource).toContain(".workspace-chip-down");
    expect(globalsSource).toContain(".workspace-runner");
    expect(scriptRunnerSource).not.toContain("RunModeSelector");
    expect(scriptRunnerSource).not.toContain("Run mode");
    expect(globalsSource).toContain(".workspace-runner-field");
    expect(globalsSource).toContain(".workspace-sidebar-column");
    expect(globalsSource).toContain("container-name: workspace-sidebar");
    expect(globalsSource).toContain("@container workspace-sidebar");
    expect(globalsSource).toContain(".workspace-sidebar-resizer");
    expect(globalsSource).toContain("grid-template-columns: auto 12px minmax(0, 1fr) 12px auto");
    expect(globalsSource).toContain(".workspace-script-name");
    expect(globalsSource).toContain(".workspace-editor-tab-active");
    expect(globalsSource).toContain(".workspace-editor-height-resizer");
    expect(globalsSource).toContain("padding: 4px 24px 12px;");
    expect(globalsSource).toContain("padding: 16px 24px 24px;");
    expect(globalsSource).toContain("font-size: 2.3rem;");
    expect(globalsSource).toContain("font-size: 1.64rem;");
    expect(globalsSource).toContain("font-size: 1.5rem;");
    expect(globalsSource).toContain(".workspace-about-help-dialog");
    expect(globalsSource).toContain(".workspace-about-help-header");
    expect(globalsSource).toContain(".workspace-about-help-section");
    expect(globalsSource).toContain(".workspace-about-help-steps");
    expect(globalsSource).toContain(".workspace-top-action-button");
    expect(globalsSource).toContain("font-size: 1.2rem;");
  });
});
