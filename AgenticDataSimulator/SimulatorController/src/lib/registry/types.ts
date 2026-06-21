export type RegistryAgent = {
  name: string;
  domain: string;
  isHealthy: boolean | null;
  wellKnownURI: string | null;
  status: string;
  discoveryRole?: "intent-agent" | "observation-agent" | null;
};

export type RegistryAgentCard = {
  name?: string;
  domain?: string;
  description?: string;
};

export type RegistryAgentSkillRecord = {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
};

export type RegistryAgentRecord = {
  name?: string;
  description?: string;
  domain?: string;
  is_healthy?: boolean | null;
  wellKnownURI?: string | null;
  status?: string | null;
  conformance?: boolean | null;
  agent_card?: RegistryAgentCard;
  skills?: RegistryAgentSkillRecord[];
};
