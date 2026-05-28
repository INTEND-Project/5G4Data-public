import { db } from "@/lib/db";

export type ScriptRecord = {
  id: string;
  userId: string;
  domain: string;
  name: string;
  content: string;
  shared: boolean;
  lastRunMode: string | null;
  ownerUsername?: string;
};

const scriptSelect = {
  id: true,
  userId: true,
  domain: true,
  name: true,
  content: true,
  shared: true,
  lastRunMode: true,
  user: {
    select: {
      username: true,
    },
  },
} as const;

function mapScriptRow(row: {
  id: string;
  userId: string;
  domain: string;
  name: string;
  content: string;
  shared: boolean;
  lastRunMode: string | null;
  user: {
    username: string;
  };
}): ScriptRecord {
  return {
    id: row.id,
    userId: row.userId,
    domain: row.domain,
    name: row.name,
    content: row.content,
    shared: row.shared,
    lastRunMode: row.lastRunMode,
    ownerUsername: row.user?.username,
  };
}

export async function listVisibleScripts(userId: string, domain?: string): Promise<ScriptRecord[]> {
  const rows = await db.script.findMany({
    where: {
      ...(domain ? { domain } : {}),
      OR: [{ userId }, { shared: true }],
    },
    select: scriptSelect,
    orderBy: {
      updatedAt: "desc",
    },
  });

  return rows.map(mapScriptRow);
}

/** @deprecated Use listVisibleScripts */
export async function listScriptsForUser(userId: string, domain?: string): Promise<ScriptRecord[]> {
  return listVisibleScripts(userId, domain);
}

export async function createScriptForUser(input: {
  userId: string;
  domain: string;
  name: string;
  content: string;
  shared?: boolean;
  lastRunMode?: string | null;
}): Promise<ScriptRecord> {
  const row = await db.script.create({
    data: {
      userId: input.userId,
      domain: input.domain,
      name: input.name,
      content: input.content,
      shared: input.shared ?? false,
      lastRunMode: input.lastRunMode ?? null,
    },
    select: scriptSelect,
  });

  return mapScriptRow(row);
}

export async function getScriptForUser(userId: string, id: string): Promise<ScriptRecord | null> {
  const row = await db.script.findFirst({
    where: {
      id,
      userId,
    },
    select: scriptSelect,
  });

  return row ? mapScriptRow(row) : null;
}

export async function getVisibleScript(userId: string, id: string): Promise<ScriptRecord | null> {
  const row = await db.script.findFirst({
    where: {
      id,
      OR: [{ userId }, { shared: true }],
    },
    select: scriptSelect,
  });

  return row ? mapScriptRow(row) : null;
}

export async function updateScriptForUser(
  id: string,
  input: {
    name?: string;
    content?: string;
    lastRunMode?: string | null;
  },
): Promise<ScriptRecord> {
  const row = await db.script.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.lastRunMode !== undefined ? { lastRunMode: input.lastRunMode } : {}),
    },
    select: scriptSelect,
  });

  return mapScriptRow(row);
}

export async function deleteScriptForUser(id: string) {
  return db.script.delete({
    where: { id },
    select: {
      id: true,
    },
  });
}
