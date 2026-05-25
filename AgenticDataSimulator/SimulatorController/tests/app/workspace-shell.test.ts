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
    const domainSelectorSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/domain-selector.tsx"),
      "utf8",
    );
    const kgTargetPanelSource = readFileSync(
      resolve(process.cwd(), "src/components/workspace/kg-target-panel.tsx"),
      "utf8",
    );
    const globalsSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(loginSource).toContain("Sign in to OpenClaw Controller");
    expect(loginSource).toContain('withAppBasePath("/api/auth/login")');
    expect(loginSource).toContain('withAppBasePath("/api/auth/register")');
    expect(workspaceSource).toContain("WorkspaceShell");
    expect(workspaceSource).toContain("getRegistryConnectionStatus");
    expect(workspaceSource).toContain("registryConnected");
    expect(workspaceSource).toContain("kgTargetsCreateUrl");
    expect(workspaceSource).toContain("kgTargetsDeleteUrlBase");
    expect(workspaceSource).toContain('withAppBasePath("/api/kg-targets")');
    expect(workspaceSource).toContain('withAppBasePath("/api/scripts")');
    expect(shellSource).not.toContain("INTEND Controller");
    expect(shellSource).not.toContain("OpenClaw Workspace");
    expect(shellSource).toContain("registryConnected");
    expect(shellSource).toContain("INTEND Data Generation Controller Studio");
    expect(shellSource).toContain(
      "TM Forum intent data generation script design and execution for cognitive continuum",
    );
    expect(shellSource).toContain("intend-icon.png");
    expect(shellSource).toContain("agent registry connected");
    expect(shellSource).toContain("agent registry disconnected");
    expect(shellSource).toContain("WorkspaceRunIdChip");
    expect(runIdChipSource).toContain("formatScriptRunListLabel");
    expect(runIdChipSource).toContain("workspace-topbar-run-select");
    expect(runIdChipSource).toContain("scriptRunLogs");
    expect(scriptSessionContextSource).toContain("slice(0, 10)");
    expect(shellSource).toContain("About/Help");
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
    expect(shellSource).toContain("scriptsApiUrl");
    expect(shellSource).toContain("WorkspaceScriptSessionProvider");
    expect(shellSource).toContain("WorkspaceLeftSidebarResizable");
    expect(shellSource).toContain("WorkspaceRightSidebarResizable");
    expect(scriptRunnerSource).toContain("Run mode");
    expect(scriptRunnerSource).toContain("dry-run");
    expect(scriptRunnerSource).toContain("execute");
    expect(scriptRunnerSource).toContain("Knowledge graph target");
    expect(scriptRunnerSource).toContain("kg-avalanche-demo");
    expect(scriptRunnerSource).toContain("Run result policy");
    expect(scriptRunnerSource).toContain("stop on first error");
    expect(scriptRunnerSource).toContain("Run Script");
    expect(scriptRunnerSource).toContain("selectedRunLogLines");
    expect(scriptRunnerSource).toContain("Save As");
    expect(scriptRunnerSource).toContain("workspace-editor-height-resizer");
    expect(scriptRunnerSource).toContain("workspace-editor-tabs");
    expect(scriptRunnerSource).toContain("role=\"tablist\"");
    expect(workspaceSource).toContain("agentsRefreshUrl");
    expect(workspaceSource).toContain('refresh: "1"');
    expect(agentListSource).toContain("Available agents");
    expect(agentListSource).toContain("healthyAgentCount");
    expect(agentListSource).toContain('"use client"');
    expect(agentListSource).toContain("Refresh");
    expect(agentListSource).toContain("fetch(refreshUrl");
    expect(agentListSource).toContain("setDisplayedAgents");
    expect(agentListSource).toContain("workspace-partner-grid");
    expect(agentListSource).toContain("workspace-partner-tile");
    expect(agentListSource).toContain("intendproject.eu/assets/1-sintef-4b735e01.png");
    expect(agentListSource).toContain("intendproject.eu/assets/13-telenor-860e8851.png");
    expect(agentListSource).toContain("intendproject.eu/assets/8-ericsson-2ecdf414.png");
    expect(agentListSource).toContain("intendproject.eu/assets/3-tuw-0f8a1ebe.png");
    expect(agentListSource).toContain('alt="Sintef"');
    expect(agentListSource).toContain('alt="Telenor"');
    expect(agentListSource).toContain('alt="Ericsson"');
    expect(agentListSource).toContain('alt="TUW"');
    expect(agentListSource).toContain("agent.isHealthy === false");
    expect(agentListSource).toContain("workspace-dot-down");
    expect(agentListSource).toContain("workspace-dot-unknown");
    expect(domainSelectorSource).toContain("Select domain:");
    expect(domainSelectorSource).toContain("workspace-section-title");
    expect(domainSelectorSource).toContain("workspace-select-compact");
    expect(domainSelectorSource).toContain("workspace-section-compact");
    expect(domainSelectorSource).toContain("workspace-section-domain");
    expect(domainSelectorSource).toContain("workspace-select-tight");
    expect(kgTargetPanelSource).toContain('"use client"');
    expect(kgTargetPanelSource).toContain("fetch(createUrl");
    expect(kgTargetPanelSource).toContain("setDisplayedTargets");
    expect(kgTargetPanelSource).toContain("selectedDomain");
    expect(kgTargetPanelSource).toContain("window.confirm");
    expect(kgTargetPanelSource).toContain("fetch(`${deleteUrlBase}/");
    expect(kgTargetPanelSource).toContain('method: "DELETE"');
    expect(kgTargetPanelSource).toContain("Deleting...");
    expect(kgTargetPanelSource).toContain('aria-label={`Delete ${target.displayName}`}');
    expect(kgTargetPanelSource).not.toContain(
      "Repository and named graph creation will be wired to GraphDB in the next task.",
    );
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
    expect(globalsSource).toContain("select.workspace-topbar-run-select");
    expect(globalsSource).toContain(".workspace-chip-live");
    expect(globalsSource).toContain(".workspace-chip-down");
    expect(globalsSource).toContain(".workspace-runner");
    expect(globalsSource).toContain(".workspace-runner-field");
    expect(globalsSource).toContain(".workspace-runner-modes");
    expect(globalsSource).toContain(".workspace-runner-mode");
    expect(globalsSource).toContain(".workspace-runner-mode-active");
    expect(globalsSource).toContain(".workspace-sidebar-column");
    expect(globalsSource).toContain(".workspace-sidebar-resizer");
    expect(globalsSource).toContain("grid-template-columns: auto 8px minmax(0, 1fr) 8px auto");
    expect(globalsSource).toContain(".workspace-script-name");
    expect(globalsSource).toContain(".workspace-editor-tab-active");
    expect(globalsSource).toContain(".workspace-editor-height-resizer");
    expect(globalsSource).toContain("padding: 4px 24px 12px;");
    expect(globalsSource).toContain("padding: 16px 24px 24px;");
    expect(globalsSource).toContain("font-size: 2.3rem;");
    expect(globalsSource).toContain("font-size: 1.64rem;");
    expect(globalsSource).toContain("font-size: 1.5rem;");
    expect(globalsSource).toContain("font-size: 1.6rem;");
  });
});
