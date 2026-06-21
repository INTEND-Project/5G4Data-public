import { suggestsIntentGeneration } from "@/lib/registry/intent-agent-discovery";
import { suggestsObservationControl } from "@/lib/registry/observation-agent-discovery";
import {
  discoveryRoleFromSkillTags,
  type DiscoveryRole,
} from "@/lib/registry/discovery-task-tags";
import type { RegistryAgentRecord } from "@/lib/registry/types";

export type { DiscoveryRole } from "@/lib/registry/discovery-task-tags";
export {
  agentNameMatchesPreferred,
  DISCOVERY_TASK_TAG_INTENT,
  DISCOVERY_TASK_TAG_OBSERVATION,
  DISCOVERY_TASK_TAG_PREFIX,
} from "@/lib/registry/discovery-task-tags";

export function resolveDiscoveryRole(
  record: RegistryAgentRecord,
  normalizedAgentName?: string,
): DiscoveryRole | null {
  const fromTags = discoveryRoleFromSkillTags(record);
  if (fromTags) {
    return fromTags;
  }

  if (suggestsIntentGeneration(record, normalizedAgentName)) {
    return "intent-agent";
  }

  if (suggestsObservationControl(record, normalizedAgentName)) {
    return "observation-agent";
  }

  return null;
}

export function discoveryRoleLabel(role: DiscoveryRole): string {
  return role === "intent-agent" ? "Intent generating" : "Observation control";
}
