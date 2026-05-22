import { db } from "@/lib/db";

export type ScriptRecord = {
  id: string;
  userId: string;
  domain: string;
  name: string;
  content: string;
  lastRunMode: string | null;
};

export async function listScriptsForUser(userId: string, domain?: string): Promise<ScriptRecord[]> {
  return db.script.findMany({
    where: {
      userId,
      ...(domain ? { domain } : {}),
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      name: true,
      content: true,
      lastRunMode: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function createScriptForUser(input: {
  userId: string;
  domain: string;
  name: string;
  content: string;
  lastRunMode?: string | null;
}): Promise<ScriptRecord> {
  return db.script.create({
    data: {
      userId: input.userId,
      domain: input.domain,
      name: input.name,
      content: input.content,
      lastRunMode: input.lastRunMode ?? null,
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      name: true,
      content: true,
      lastRunMode: true,
    },
  });
}

export async function getScriptForUser(userId: string, id: string): Promise<ScriptRecord | null> {
  return db.script.findFirst({
    where: {
      id,
      userId,
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      name: true,
      content: true,
      lastRunMode: true,
    },
  });
}

export async function updateScriptForUser(
  id: string,
  input: {
    name?: string;
    content?: string;
    lastRunMode?: string | null;
  },
): Promise<ScriptRecord> {
  return db.script.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.lastRunMode !== undefined ? { lastRunMode: input.lastRunMode } : {}),
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      name: true,
      content: true,
      lastRunMode: true,
    },
  });
}

export async function deleteScriptForUser(id: string) {
  return db.script.delete({
    where: { id },
    select: {
      id: true,
    },
  });
}
