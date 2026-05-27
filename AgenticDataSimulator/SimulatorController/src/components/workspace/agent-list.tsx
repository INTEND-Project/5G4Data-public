"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { registryPollIntervalMs } from "@/components/workspace/infra-connection-status";

type AgentListItem = {
  name: string;
  isHealthy: boolean | null;
};

type AgentListProps = {
  agents: AgentListItem[];
  refreshUrl: string;
  registryConnected: boolean;
};

function agentsEqual(left: AgentListItem[], right: AgentListItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (agent, index) =>
      agent.name === right[index]?.name && agent.isHealthy === right[index]?.isHealthy,
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

export function AgentList({ agents, refreshUrl, registryConnected }: AgentListProps) {
  const [displayedAgents, setDisplayedAgents] = useState(agents);
  const registryConnectedRef = useRef(registryConnected);
  const registeredAgentCount = displayedAgents.length;

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

    void refreshAgents({ forceRefresh: true });
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

  return (
    <div className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Available agents</h2>
        <span
          className={`workspace-chip ${
            registryConnected ? "workspace-chip-live" : "workspace-chip-down"
          }`}
        >
          {registryConnected ? `${registeredAgentCount} registered` : "registry disconnected"}
        </span>
      </div>
      <div className="workspace-stack">
        {displayedAgents.map((agent) => (
          <article className="workspace-agent" key={agent.name}>
            <strong>{agent.name}</strong>
            <div className="workspace-agent-indicators">
              <span className="workspace-chip workspace-chip-live workspace-agent-registry-chip">
                registered
              </span>
              <AgentHealthIcon isHealthy={agent.isHealthy} />
            </div>
          </article>
        ))}
      </div>
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
    </div>
  );
}
