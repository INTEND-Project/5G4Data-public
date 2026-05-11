"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type AgentListItem = {
  name: string;
  isHealthy: boolean | null;
};

type AgentListProps = {
  agents: AgentListItem[];
  refreshUrl: string;
};

export function AgentList({ agents, refreshUrl }: AgentListProps) {
  const [displayedAgents, setDisplayedAgents] = useState(agents);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const healthyAgentCount = displayedAgents.filter((agent) => agent.isHealthy === true).length;

  useEffect(() => {
    setDisplayedAgents(agents);
  }, [agents]);

  async function handleRefresh() {
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const response = await fetch(refreshUrl, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Agent refresh failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        agents: AgentListItem[];
      };

      setDisplayedAgents(payload.agents);
    } catch (error) {
      console.error(error);
      setRefreshError("Unable to refresh agents right now.");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Available agents</h2>
        <span className="workspace-chip">{healthyAgentCount} live</span>
      </div>
      <div className="workspace-stack">
        {displayedAgents.map((agent) => (
          <article className="workspace-agent" key={agent.name}>
            <span
              className={`workspace-dot ${
                agent.isHealthy === true
                  ? "workspace-dot-live"
                  : agent.isHealthy === false
                    ? "workspace-dot-down"
                    : "workspace-dot-unknown"
              }`}
            />
            <strong>{agent.name}</strong>
          </article>
        ))}
      </div>
      <div className="workspace-inline-row">
        <button
          className="workspace-button workspace-button-secondary"
          disabled={isRefreshing}
          onClick={() => void handleRefresh()}
          type="button"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {refreshError ? (
        <p aria-live="polite" className="workspace-hint">
          {refreshError}
        </p>
      ) : null}
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
