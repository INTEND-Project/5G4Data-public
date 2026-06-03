import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/guards";
import { buildDraftContext } from "@/lib/assistant/build-draft-context";
import { withAppBasePath } from "@/lib/app-paths";
import { db } from "@/lib/db";
import { buildCompletionContext } from "@/lib/dsl/analysis/build-completion-context";
import { loadAppEnv } from "@/lib/env";
import { listVisibleScripts } from "@/lib/scripts/repository";

const DEFAULT_WORKSPACE_DOMAIN = "telenor.5g4data";

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
  const selectedDomain =
    resolvedSearchParams?.domain?.trim() || DEFAULT_WORKSPACE_DOMAIN;
  const agentsRefreshUrl = withAppBasePath(
    `/api/agents?${new URLSearchParams({
      domain: selectedDomain,
    }).toString()}`,
  );
  const domainsApiUrl = withAppBasePath("/api/domains");
  const kgTargetsCreateUrl = withAppBasePath("/api/kg-targets");
  const kgTargetsDeleteUrlBase = withAppBasePath("/api/kg-targets");
  const scriptsApiUrl = withAppBasePath("/api/scripts");
  const runLogsApiUrl = withAppBasePath("/api/run-logs");
  const intentsRegisterUrl = withAppBasePath("/api/intents/register");
  const discoverIntentAgentApiUrl = withAppBasePath("/api/registry/discover-intent-agent");
  const discoverObservationAgentApiUrl = withAppBasePath(
    "/api/registry/discover-observation-agent",
  );
  const a2aMessageSendUrl = withAppBasePath("/api/a2a/message-send");
  const openAiModelsApiUrl = withAppBasePath("/api/openai/models");
  const agentRuntimeLlmApiUrlBase = withAppBasePath("/api/agents");
  const previewMetricsApiUrl = withAppBasePath("/api/workload-catalogue/preview-metrics");
  const infraStatusApiUrl = withAppBasePath("/api/infra/status");
  const intentsApiUrl = withAppBasePath("/api/intents");
  const intentsUrlBase = withAppBasePath("/api/intents");
  const prometheusClearUrlBase = withAppBasePath("/api/prometheus/intents");

  const [scripts, kgTargets] = await Promise.all([
    listVisibleScripts(user.id, selectedDomain),
    db.knowledgeGraphTarget.findMany({
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
    }),
  ]);

  const fallbackScript = "";
  const extractedMetricCatalogs: Record<string, string[]> = {};
  const completionContext = buildCompletionContext({
    script: fallbackScript,
    extractedMetricCatalogs,
  });
  const assistantContext = buildDraftContext({
    selectedDomain,
    availableAgents: [],
    metricNames: completionContext.metricNames,
    stage: completionContext.stage,
    assistantModel: appEnv.assistantModel,
  });

  return (
    <WorkspaceShell
      agents={[]}
      agentsRefreshUrl={agentsRefreshUrl}
      openAiModelsApiUrl={openAiModelsApiUrl}
      agentRuntimeLlmApiUrlBase={agentRuntimeLlmApiUrlBase}
      assistantContext={assistantContext}
      domains={[selectedDomain]}
      domainsApiUrl={domainsApiUrl}
      kgTargetsCreateUrl={kgTargetsCreateUrl}
      kgTargetsDeleteUrlBase={kgTargetsDeleteUrlBase}
      kgTargets={kgTargets}
      currentUserId={user.id}
      intentsRegisterUrl={intentsRegisterUrl}
      runLogsApiUrl={runLogsApiUrl}
      scriptsApiUrl={scriptsApiUrl}
      discoverIntentAgentApiUrl={discoverIntentAgentApiUrl}
      discoverObservationAgentApiUrl={discoverObservationAgentApiUrl}
      a2aMessageSendUrl={a2aMessageSendUrl}
      previewMetricsApiUrl={previewMetricsApiUrl}
      graphDbBaseUrl={appEnv.graphDbBaseUrl}
      defaultPrometheusBaseUrl={appEnv.prometheusUrl}
      graphDbConnected={false}
      infraStatusApiUrl={infraStatusApiUrl}
      intentsApiUrl={intentsApiUrl}
      intentsUrlBase={intentsUrlBase}
      prometheusClearUrlBase={prometheusClearUrlBase}
      prometheusConnected={false}
      registryConnected={false}
      scripts={scripts}
      selectedDomain={selectedDomain}
      username={user.username}
    />
  );
}
