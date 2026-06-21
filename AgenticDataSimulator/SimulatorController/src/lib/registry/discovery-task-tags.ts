import type { RegistryAgentRecord } from "@/lib/registry/types";

export type DiscoveryRole = "intent-agent" | "observation-agent";

export const DISCOVERY_TASK_TAG_PREFIX = "discovery-task:";

export const DISCOVERY_TASK_TAG_INTENT = `${DISCOVERY_TASK_TAG_PREFIX}intent-agent` as const;
export const DISCOVERY_TASK_TAG_OBSERVATION =
  `${DISCOVERY_TASK_TAG_PREFIX}observation-agent` as const;

function normalizeToken(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function discoveryRoleFromSkillTags(
  record: RegistryAgentRecord,
): DiscoveryRole | null {
  for (const skill of record.skills ?? []) {
    for (const tag of skill.tags ?? []) {
      const normalized = normalizeToken(tag);
      if (normalized === DISCOVERY_TASK_TAG_INTENT) {
        return "intent-agent";
      }
      if (normalized === DISCOVERY_TASK_TAG_OBSERVATION) {
        return "observation-agent";
      }
    }
  }
  return null;
}

export function agentNameMatchesPreferred(
  candidateName: string,
  preferredAgentName: string,
): boolean {
  return normalizeToken(candidateName) === normalizeToken(preferredAgentName);
}
