import { normalizeRegistryAgents } from "@/lib/registry/normalize";
import { discoveryRoleFromSkillTags, agentNameMatchesPreferred } from "@/lib/registry/discovery-task-tags";
import type { RegistryAgent, RegistryAgentRecord, RegistryAgentSkillRecord } from "@/lib/registry/types";

export type IntentAgentDiscoveryResult = {
  wellKnownURI: string;
  name: string;
  domain: string;
};

export type IntentAgentDiscoveryOptions = {
  preferredAgentName?: string;
};

function normalizeToken(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function skillBlob(skill: RegistryAgentSkillRecord): string {
  const parts = [skill.id, skill.name, skill.description, ...(skill.tags ?? [])];
  return normalizeToken(parts.filter(Boolean).join(" "));
}

export function suggestsIntentGeneration(
  record: RegistryAgentRecord,
  normalizedAgentName?: string,
): boolean {
  const taggedRole = discoveryRoleFromSkillTags(record);
  if (taggedRole === "intent-agent") {
    return true;
  }
  if (taggedRole === "observation-agent") {
    return false;
  }

  const name = normalizeToken(
    record.name ?? normalizedAgentName ?? record.agent_card?.name ?? "",
  );

  if (name.includes("intent-observation") || name.includes("observation-generating-agent")) {
    return false;
  }

  const desc = normalizeToken(record.description ?? record.agent_card?.description ?? "");

  if (desc.includes("intent definitions") || desc.includes("deployment-ready payload")) {
    return true;
  }

  const skills = record.skills ?? [];
  for (const skill of skills) {
    const id = normalizeToken(skill.id);
    const skillName = normalizeToken(skill.name);
    if (id.includes("generate-intent") || skillName.includes("generate intent")) {
      return true;
    }

    const blob = `${id} ${skillName} ${skillBlob(skill)}`;
    if (
      blob.includes("intent") &&
      (blob.includes("generat") || blob.includes("payload")) &&
      !blob.includes("observ")
    ) {
      return true;
    }
  }

  return false;
}

function preferenceScore(record: RegistryAgentRecord): number {
  if (record.is_healthy === true) {
    return 2;
  }
  if (record.is_healthy === false) {
    return 0;
  }
  return 1;
}

export function pickIntentGeneratingAgent(
  records: RegistryAgentRecord[],
  domain: string,
  options?: IntentAgentDiscoveryOptions,
): IntentAgentDiscoveryResult | null {
  const normalized = normalizeRegistryAgents(records);
  const byWellKnown = new Map<string, RegistryAgent>();
  for (const agent of normalized) {
    if (agent.wellKnownURI) {
      byWellKnown.set(String(agent.wellKnownURI), agent);
    }
  }

  const candidates: Array<{ result: IntentAgentDiscoveryResult; record: RegistryAgentRecord }> = [];

  for (const record of records) {
    const wk = record.wellKnownURI ? String(record.wellKnownURI) : "";
    if (!wk) {
      continue;
    }
    const normalizedRow = byWellKnown.get(wk);

    if (!normalizedRow || normalizedRow.domain !== domain) {
      continue;
    }

    if (!suggestsIntentGeneration(record, normalizedRow.name)) {
      continue;
    }

    candidates.push({
      result: {
        wellKnownURI: wk,
        name: normalizedRow.name,
        domain: normalizedRow.domain,
      },
      record,
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  const preferredName = options?.preferredAgentName?.trim();
  if (preferredName) {
    const preferred = candidates.find((candidate) =>
      agentNameMatchesPreferred(candidate.result.name, preferredName),
    );
    if (preferred) {
      return preferred.result;
    }
  }

  candidates.sort((a, b) => preferenceScore(b.record) - preferenceScore(a.record));
  return candidates[0]?.result ?? null;
}
