import type { RegistryAgent, RegistryAgentRecord } from "@/lib/registry/types";

function normalizeStatus(record: RegistryAgentRecord) {
  if (record.status) {
    return record.status;
  }

  if (record.conformance === true) {
    return "conformant";
  }

  if (record.conformance === false) {
    return "non-conformant";
  }

  return "unknown";
}

function normalizeHintToken(token: string) {
  return token.trim().toLowerCase();
}

function getDirectDomain(record: RegistryAgentRecord) {
  return record.domain ?? record.agent_card?.domain;
}

function collectHintTokens(record: RegistryAgentRecord, domain?: string) {
  const tokens = new Set<string>();
  const addToken = (value: string | undefined) => {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
      return;
    }

    tokens.add(normalizeHintToken(normalizedValue));

    for (const part of normalizedValue.split(/[^a-zA-Z0-9]+/)) {
      if (part) {
        tokens.add(normalizeHintToken(part));
      }
    }
  };

  addToken(record.name);
  addToken(domain);

  for (const skill of record.skills ?? []) {
    for (const tag of skill.tags ?? []) {
      addToken(tag);
    }
  }

  return tokens;
}

function buildDomainHints(input: RegistryAgentRecord[]) {
  const hints = new Map<string, string>();

  for (const record of input) {
    const domain = getDirectDomain(record);

    if (!domain) {
      continue;
    }

    for (const token of collectHintTokens(record, domain)) {
      hints.set(token, domain);
    }
  }

  return hints;
}

function inferDomain(record: RegistryAgentRecord, domainHints: Map<string, string>) {
  const directDomain = getDirectDomain(record);

  if (directDomain) {
    return directDomain;
  }

  for (const token of collectHintTokens(record)) {
    const hintedDomain = domainHints.get(token);

    if (hintedDomain) {
      return hintedDomain;
    }
  }

  return undefined;
}

export function normalizeRegistryAgents(input: RegistryAgentRecord[]): RegistryAgent[] {
  const domainHints = buildDomainHints(input);

  return input.flatMap((record) => {
    const name = record.name ?? record.agent_card?.name;
    const domain = inferDomain(record, domainHints);

    if (!name || !domain) {
      return [];
    }

    return [
      {
        name,
        domain,
        isHealthy: record.is_healthy ?? null,
        wellKnownURI: record.wellKnownURI ?? null,
        status: normalizeStatus(record),
      },
    ];
  });
}

export function deriveDomains(agents: RegistryAgent[]) {
  return Array.from(new Set(agents.map((agent) => agent.domain))).sort();
}
