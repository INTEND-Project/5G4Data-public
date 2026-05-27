import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/guards";
import { buildDraftContext } from "@/lib/assistant/build-draft-context";
import { withAppBasePath } from "@/lib/app-paths";
import { db } from "@/lib/db";
import { buildCompletionContext } from "@/lib/dsl/analysis/build-completion-context";
import { loadAppEnv } from "@/lib/env";
import { listNormalizedAgents } from "@/lib/registry/client";
import { deriveDomains } from "@/lib/registry/normalize";
import { getInfraConnectionStatus } from "@/lib/infra/connection-status";
import { listScriptsForUser } from "@/lib/scripts/repository";

type WorkspacePageProps = {
  searchParams?: Promise<{
    domain?: string;
  }>;
};

export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const user = await getAuthenticatedUserFromCookies(await cookies());

  if (!user) {
    redirect("/login");
  }

  const appEnv = loadAppEnv(process.env);

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const normalizedAgents = await listNormalizedAgents();
  const domains = deriveDomains(normalizedAgents);
  const selectedDomain = resolvedSearchParams?.domain ?? domains[0] ?? "telenor.5g4data";
  const agents = normalizedAgents.filter((agent) => agent.domain === selectedDomain);
  const agentNames = agents.map((agent) => agent.name);
  const agentsRefreshUrl = withAppBasePath(
    `/api/agents?${new URLSearchParams({
      domain: selectedDomain,
      refresh: "1",
    }).toString()}`,
  );
  const kgTargetsCreateUrl = withAppBasePath("/api/kg-targets");
  const kgTargetsDeleteUrlBase = withAppBasePath("/api/kg-targets");
  const scriptsApiUrl = withAppBasePath("/api/scripts");
  const discoverIntentAgentApiUrl = withAppBasePath("/api/registry/discover-intent-agent");
  const discoverObservationAgentApiUrl = withAppBasePath(
    "/api/registry/discover-observation-agent",
  );
  const a2aMessageSendUrl = withAppBasePath("/api/a2a/message-send");
  const infraStatusApiUrl = withAppBasePath("/api/infra/status");
  const intentsApiUrl = withAppBasePath("/api/intents");
  const intentsUrlBase = withAppBasePath("/api/intents");
  const prometheusClearUrlBase = withAppBasePath("/api/prometheus/intents");
  const { registryConnected, graphDbConnected, prometheusConnected } =
    await getInfraConnectionStatus();
  const scripts = await listScriptsForUser(user.id, selectedDomain);
  const fallbackScript = "";
  const extractedMetricCatalogs: Record<string, string[]> = {};
  const completionContext = buildCompletionContext({
    script: fallbackScript,
    extractedMetricCatalogs,
  });
  const assistantContext = buildDraftContext({
    selectedDomain,
    availableAgents: agentNames,
    metricNames: completionContext.metricNames,
    stage: completionContext.stage,
    assistantModel: appEnv.assistantModel,
  });
  const kgTargets = await db.knowledgeGraphTarget.findMany({
    where: {
      userId: user.id,
      domain: selectedDomain,
    },
    select: {
      id: true,
      displayName: true,
      repositoryId: true,
      graphIri: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <WorkspaceShell
      agents={agents}
      agentsRefreshUrl={agentsRefreshUrl}
      assistantContext={assistantContext}
      domains={domains}
      kgTargetsCreateUrl={kgTargetsCreateUrl}
      kgTargetsDeleteUrlBase={kgTargetsDeleteUrlBase}
      kgTargets={kgTargets}
      scriptsApiUrl={scriptsApiUrl}
      discoverIntentAgentApiUrl={discoverIntentAgentApiUrl}
      discoverObservationAgentApiUrl={discoverObservationAgentApiUrl}
      a2aMessageSendUrl={a2aMessageSendUrl}
      graphDbBaseUrl={appEnv.graphDbBaseUrl}
      graphDbConnected={graphDbConnected}
      infraStatusApiUrl={infraStatusApiUrl}
      intentsApiUrl={intentsApiUrl}
      intentsUrlBase={intentsUrlBase}
      prometheusClearUrlBase={prometheusClearUrlBase}
      prometheusConnected={prometheusConnected}
      registryConnected={registryConnected}
      scripts={scripts}
      selectedDomain={selectedDomain}
      username={user.username}
    />
  );
}
