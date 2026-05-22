import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedDomainPackage } from "../packageLoader.js";

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  domain?: string;
  url: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    inputModes: string[];
    outputModes: string[];
  }>;
}

export interface A2ARegistrationResult {
  attempted: boolean;
  ok: boolean;
  status?: number;
  message: string;
  wellKnownURI?: string;
}

export interface A2AConfig {
  a2aEnabled: boolean;
  a2aRegistryBaseUrl: string;
  a2aAgentBaseUrl: string;
  a2aAgentCardPath: string;
  a2aAutoRegisterOnStartup: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeCardPath(value: string): string {
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

function normalizeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "agent";
}

function buildAgentPublicBaseUrl(baseUrl: string, cardName: string): string {
  return `${trimTrailingSlash(baseUrl)}/${normalizeSlug(cardName)}`;
}

function createPackageSkill(packageName: string): AgentCard["skills"][number] {
  return {
    id: `${packageName}-turn`,
    name: `${packageName} turn execution`,
    description: `Primary intent-processing skill for package ${packageName}.`,
    tags: [packageName, "openclaw", "intent"],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"]
  };
}

function normalizeSkills(
  packageName: string,
  incoming: LoadedDomainPackage["agentCardPartial"]
): AgentCard["skills"] {
  const partialSkills = incoming?.skills;
  if (!partialSkills || partialSkills.length === 0) {
    return [createPackageSkill(packageName)];
  }
  return partialSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tags: skill.tags ?? [],
    inputModes: skill.inputModes ?? ["text/plain"],
    outputModes: skill.outputModes ?? ["text/plain"]
  }));
}

export function buildAgentCard(config: A2AConfig, domainPackage: LoadedDomainPackage): AgentCard {
  const packageName = domainPackage.manifest.name;
  const partial = domainPackage.agentCardPartial;
  const cardName = partial?.name ?? packageName;
  const publicBaseUrl = buildAgentPublicBaseUrl(config.a2aAgentBaseUrl, cardName);
  return {
    protocolVersion: partial?.protocolVersion ?? "0.3.0",
    name: cardName,
    description: partial?.description ?? `SimulatorAgentKernel package runtime for ${packageName}`,
    domain: partial?.domain,
    url: `${publicBaseUrl}/v1`,
    version: partial?.version ?? domainPackage.manifest.version,
    capabilities: {
      streaming: partial?.capabilities?.streaming ?? false,
      pushNotifications: partial?.capabilities?.pushNotifications ?? false,
      stateTransitionHistory: partial?.capabilities?.stateTransitionHistory ?? false
    },
    defaultInputModes: partial?.defaultInputModes ?? ["text/plain"],
    defaultOutputModes: partial?.defaultOutputModes ?? ["text/plain"],
    skills: normalizeSkills(packageName, partial)
  };
}

export function buildWellKnownAgentCardUrl(config: A2AConfig, cardName: string): string {
  const baseUrl = buildAgentPublicBaseUrl(config.a2aAgentBaseUrl, cardName);
  const cardPath = normalizeCardPath(config.a2aAgentCardPath);
  return `${baseUrl}${cardPath}`;
}

export function persistAgentCard(cwd: string, card: AgentCard, cardPath: string): string {
  const normalized = normalizeCardPath(cardPath);
  const filePath = join(cwd, normalized.replace(/^\//, ""));
  const parentDir = filePath.slice(0, filePath.lastIndexOf("/"));
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(filePath, `${JSON.stringify(card, null, 2)}\n`, "utf8");
  return filePath;
}

export async function registerAgentCard(
  config: A2AConfig,
  cardName: string
): Promise<A2ARegistrationResult> {
  if (!config.a2aEnabled) {
    return { attempted: false, ok: false, message: "A2A disabled." };
  }

  const wellKnownURI = buildWellKnownAgentCardUrl(config, cardName);
  const endpoint = `${trimTrailingSlash(config.a2aRegistryBaseUrl)}/api/agents/register`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wellKnownURI })
    });
    const bodyText = await response.text();
    if (response.ok || response.status === 409) {
      return {
        attempted: true,
        ok: true,
        status: response.status,
        message: response.status === 409 ? "Already registered." : "Registered successfully.",
        wellKnownURI
      };
    }
    return {
      attempted: true,
      ok: false,
      status: response.status,
      message: `Registration failed: ${bodyText || "unknown error"}`,
      wellKnownURI
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      message: `Registration error: ${String(error)}`,
      wellKnownURI
    };
  }
}
