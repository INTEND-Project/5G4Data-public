"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { AgentSettingsDialog } from "@/components/workspace/agent-settings-dialog";
import { useAgentDiscoveryPreferences } from "@/components/workspace/agent-discovery-preferences-context";
import { registryPollIntervalMs } from "@/components/workspace/infra-connection-status";
import { WorkspaceCollapsibleSection } from "@/components/workspace/workspace-collapsible-section";
import { discoveryRoleLabel } from "@/lib/registry/agent-discovery-roles";
import type { DiscoveryRole } from "@/lib/registry/discovery-task-tags";

type AgentListItem = {
  name: string;
  domain: string;
  isHealthy: boolean | null;
  discoveryRole?: DiscoveryRole | null;
};

type AgentListProps = {
  agents: AgentListItem[];
  refreshUrl: string;
  registryConnected: boolean;
  openAiModelsApiUrl: string;
  agentRuntimeLlmApiUrlBase: string;
  /** Rendered after the agent list (e.g. Tools panel); partner logos render below toolsSlot. */
  toolsSlot?: ReactNode;
};

function agentsEqual(left: AgentListItem[], right: AgentListItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (agent, index) =>
      agent.name === right[index]?.name &&
      agent.domain === right[index]?.domain &&
      agent.isHealthy === right[index]?.isHealthy &&
      agent.discoveryRole === right[index]?.discoveryRole,
  );
}

function AgentHealthIcon({ isHealthy }: { isHealthy: boolean | null }) {
  const title =
    isHealthy === true
      ? "Agent is healthy"
      : isHealthy === false
        ? "Agent is unhealthy"
        : "Agent health unknown";

  return (
    <span
      aria-label={title}
      className={`workspace-agent-health-icon ${
        isHealthy === true
          ? "workspace-agent-health-icon-live"
          : isHealthy === false
            ? "workspace-agent-health-icon-down"
            : "workspace-agent-health-icon-unknown"
      }`}
      title={title}
    >
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
        {isHealthy === true ? (
          <path
            d="M12 21s-6.2-4.35-8.5-7.4C1.8 11.1 2.6 8.4 4.9 7.1c1.6-.9 3.6-.6 4.9.8L12 10.1l2.2-2.2c1.3-1.4 3.3-1.7 4.9-.8 2.3 1.3 3.1 4 1.4 6.5C18.2 16.65 12 21 12 21z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        ) : isHealthy === false ? (
          <>
            <path
              d="M12 21s-6.2-4.35-8.5-7.4C1.8 11.1 2.6 8.4 4.9 7.1c1.6-.9 3.6-.6 4.9.8L12 10.1l2.2-2.2c1.3-1.4 3.3-1.7 4.9-.8 2.3 1.3 3.1 4 1.4 6.5C18.2 16.65 12 21 12 21z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
            <path d="M4 4l16 16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.75" />
            <path d="M12 8v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
            <circle cx="12" cy="16.5" fill="currentColor" r="1" />
          </>
        )}
      </svg>
    </span>
  );
}

function AgentPreferredIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" fill={filled ? "currentColor" : "none"} height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M12 2.5l2.55 5.18 5.7.83-4.12 4.02.97 5.67L12 15.9l-5.1 2.68.97-5.67-4.12-4.02 5.7-.83L12 2.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function AgentConfigureIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34 1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

export function AgentList({
  agents,
  refreshUrl,
  registryConnected,
  openAiModelsApiUrl,
  agentRuntimeLlmApiUrlBase,
  toolsSlot,
}: AgentListProps) {
  const { isPreferred, togglePreferred } = useAgentDiscoveryPreferences();
  const [displayedAgents, setDisplayedAgents] = useState(agents);
  const [settingsAgentName, setSettingsAgentName] = useState<string | null>(null);
  const registryConnectedRef = useRef(registryConnected);

  useEffect(() => {
    setDisplayedAgents(agents);
  }, [agents]);

  useEffect(() => {
    registryConnectedRef.current = registryConnected;
  }, [registryConnected]);

  const refreshAgents = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    try {
      const requestUrl = new URL(refreshUrl, window.location.origin);
      if (options?.forceRefresh) {
        requestUrl.searchParams.set("refresh", "1");
      }

      const response = await fetch(`${requestUrl.pathname}${requestUrl.search}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        agents: AgentListItem[];
      };

      const nextAgents = payload.agents ?? [];

      setDisplayedAgents((currentAgents) =>
        agentsEqual(currentAgents, nextAgents) ? currentAgents : nextAgents,
      );
    } catch {
      /* keep last known state; next tick retries */
    }
  }, [refreshUrl]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const schedule = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }

      const intervalMs = registryPollIntervalMs(registryConnectedRef.current);
      if (intervalMs === null) {
        return;
      }

      intervalId = setInterval(() => {
        void refreshAgents();
      }, intervalMs);
    };

    void refreshAgents({ forceRefresh: !registryConnectedRef.current });
    schedule();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void refreshAgents();
        schedule();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshAgents, registryConnected]);

  const sortedAgents = useMemo(() => {
    return [...displayedAgents].sort((left, right) => {
      const leftPreferred =
        left.discoveryRole &&
        isPreferred(left.domain, left.discoveryRole, left.name);
      const rightPreferred =
        right.discoveryRole &&
        isPreferred(right.domain, right.discoveryRole, right.name);
      if (leftPreferred !== rightPreferred) {
        return leftPreferred ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [displayedAgents, isPreferred]);

  return (
    <>
      <WorkspaceCollapsibleSection sectionId="agents" title="Available agents">
        <div className="workspace-stack">
          {sortedAgents.map((agent) => {
            const role = agent.discoveryRole ?? null;
            const preferred =
              role !== null && isPreferred(agent.domain, role, agent.name);
            const preferTitle = role
              ? preferred
                ? `Remove preferred ${discoveryRoleLabel(role).toLowerCase()} agent`
                : `Prefer for ${discoveryRoleLabel(role).toLowerCase()} discovery`
              : "";

            return (
            <article className="workspace-agent" key={agent.name}>
              <div className="workspace-agent-main">
                <strong>{agent.name}</strong>
                {role ? (
                  <span className="workspace-chip workspace-agent-role-chip">
                    {discoveryRoleLabel(role)}
                  </span>
                ) : null}
              </div>
              <div className="workspace-agent-indicators">
                {role ? (
                  <button
                    aria-label={preferTitle}
                    aria-pressed={preferred}
                    className={`workspace-button workspace-button-secondary workspace-kg-target-action workspace-agent-preferred-button${
                      preferred ? " workspace-agent-preferred-button-active" : ""
                    }`}
                    onClick={() => togglePreferred(agent.domain, role, agent.name)}
                    title={preferTitle}
                    type="button"
                  >
                    <AgentPreferredIcon filled={preferred} />
                  </button>
                ) : null}
                <button
                  aria-label={`Configure LLM settings for ${agent.name}`}
                  className="workspace-button workspace-button-secondary workspace-kg-target-action workspace-agent-configure-button"
                  onClick={() => setSettingsAgentName(agent.name)}
                  title="Configure model and temperature"
                  type="button"
                >
                  <AgentConfigureIcon />
                </button>
                <span className="workspace-chip workspace-chip-live workspace-agent-registry-chip">
                  registered
                </span>
                <AgentHealthIcon isHealthy={agent.isHealthy} />
              </div>
            </article>
            );
          })}
        </div>
      </WorkspaceCollapsibleSection>
      <AgentSettingsDialog
        agentName={settingsAgentName ?? ""}
        agentRuntimeLlmApiUrl={
          settingsAgentName
            ? `${agentRuntimeLlmApiUrlBase}/${encodeURIComponent(settingsAgentName)}/runtime-llm`
            : ""
        }
        open={settingsAgentName !== null}
        openAiModelsApiUrl={openAiModelsApiUrl}
        onClose={() => setSettingsAgentName(null)}
      />
      {toolsSlot}
      <div aria-label="Project partners" className="workspace-partner-grid">
        <div className="workspace-partner-tile">
          <Image
            alt="Sintef"
            className="workspace-partner-logo"
            src="https://intendproject.eu/assets/1-sintef-4b735e01.png"
            height={28}
            width={120}
          />
        </div>
        <div className="workspace-partner-tile">
          <Image
            alt="Telenor"
            className="workspace-partner-logo"
            src="https://intendproject.eu/assets/13-telenor-860e8851.png"
            height={28}
            width={120}
          />
        </div>
        <div className="workspace-partner-tile">
          <Image
            alt="Ericsson"
            className="workspace-partner-logo"
            src="https://intendproject.eu/assets/8-ericsson-2ecdf414.png"
            height={28}
            width={120}
          />
        </div>
        <div className="workspace-partner-tile">
          <Image
            alt="TUW"
            className="workspace-partner-logo"
            src="https://intendproject.eu/assets/3-tuw-0f8a1ebe.png"
            height={28}
            width={120}
          />
        </div>
      </div>
    </>
  );
}
