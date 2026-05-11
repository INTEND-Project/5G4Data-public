export type RegistryAgent = {
  name: string;
  domain: string;
  isHealthy: boolean | null;
  wellKnownURI: string | null;
  status: string;
};

export type RegistryAgentCard = {
  name?: string;
  domain?: string;
};

export type RegistryAgentSkillRecord = {
  tags?: string[];
};

export type RegistryAgentRecord = {
  name?: string;
  domain?: string;
  is_healthy?: boolean | null;
  wellKnownURI?: string | null;
  status?: string | null;
  conformance?: boolean | null;
  agent_card?: RegistryAgentCard;
  skills?: RegistryAgentSkillRecord[];
};
