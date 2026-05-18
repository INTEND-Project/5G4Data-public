import { normalizeRegistryAgents } from "@/lib/registry/normalize";
import { suggestsIntentGeneration } from "@/lib/registry/intent-agent-discovery";
import type { RegistryAgent, RegistryAgentRecord, RegistryAgentSkillRecord } from "@/lib/registry/types";

export type ObservationAgentDiscoveryResult = {
  wellKnownURI: string;
  name: string;
  domain: string;
};

function normalizeToken(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function skillBlob(skill: RegistryAgentSkillRecord): string {
  const parts = [skill.id, skill.name, skill.description, ...(skill.tags ?? [])];
  return normalizeToken(parts.filter(Boolean).join(" "));
}

export function suggestsObservationControl(
  record: RegistryAgentRecord,
  normalizedAgentName?: string,
): boolean {
  if (suggestsIntentGeneration(record, normalizedAgentName)) {
    return false;
  }

  const name = normalizeToken(
    record.name ?? normalizedAgentName ?? record.agent_card?.name ?? "",
  );

  if (name.includes("intent-observation") || name.includes("observation-generating-agent")) {
    return true;
  }

  const desc = normalizeToken(record.description ?? record.agent_card?.description ?? "");

  if (
    desc.includes("observation") &&
    (desc.includes("control") || desc.includes("report")) &&
    desc.includes("intent")
  ) {
    return true;
  }

  const skills = record.skills ?? [];
  for (const skill of skills) {
    const id = normalizeToken(skill.id);
    const skillName = normalizeToken(skill.name);
    if (id.includes("observe-intent") || skillName.includes("observe intent")) {
      return true;
    }

    const blob = skillBlob(skill);
    if (blob.includes("observ") && blob.includes("intent")) {
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

export function pickObservationControlAgent(
  records: RegistryAgentRecord[],
  domain: string,
): ObservationAgentDiscoveryResult | null {
  const normalized = normalizeRegistryAgents(records);
  const byWellKnown = new Map<string, RegistryAgent>();
  for (const agent of normalized) {
    if (agent.wellKnownURI) {
      byWellKnown.set(String(agent.wellKnownURI), agent);
    }
  }

  const candidates: Array<{ result: ObservationAgentDiscoveryResult; record: RegistryAgentRecord }> =
    [];

  for (const record of records) {
    const wk = record.wellKnownURI ? String(record.wellKnownURI) : "";
    if (!wk) {
      continue;
    }
    const normalizedRow = byWellKnown.get(wk);

    if (!normalizedRow || normalizedRow.domain !== domain) {
      continue;
    }

    if (!suggestsObservationControl(record, normalizedRow.name)) {
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

  candidates.sort((a, b) => preferenceScore(b.record) - preferenceScore(a.record));
  return candidates[0]?.result ?? null;
}
