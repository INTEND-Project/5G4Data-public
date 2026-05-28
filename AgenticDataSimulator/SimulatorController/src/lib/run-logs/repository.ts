import { db } from "@/lib/db";

const MAX_RUN_LOGS_PER_USER_DOMAIN = 10;

export type ScriptRunLogRecord = {
  id: string;
  userId: string;
  domain: string;
  scriptName: string;
  scriptId: string | null;
  mode: string;
  lines: string[];
  startedAt: Date;
  finishedAt: Date;
};

function parseLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((line): line is string => typeof line === "string");
}

function toRecord(row: {
  id: string;
  userId: string;
  domain: string;
  scriptName: string;
  scriptId: string | null;
  mode: string;
  lines: unknown;
  startedAt: Date;
  finishedAt: Date;
}): ScriptRunLogRecord {
  return {
    id: row.id,
    userId: row.userId,
    domain: row.domain,
    scriptName: row.scriptName,
    scriptId: row.scriptId,
    mode: row.mode,
    lines: parseLines(row.lines),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function listRunLogsForUser(
  userId: string,
  domain: string,
): Promise<ScriptRunLogRecord[]> {
  const rows = await db.scriptRunLog.findMany({
    where: {
      userId,
      domain,
    },
    orderBy: {
      startedAt: "desc",
    },
    take: MAX_RUN_LOGS_PER_USER_DOMAIN,
    select: {
      id: true,
      userId: true,
      domain: true,
      scriptName: true,
      scriptId: true,
      mode: true,
      lines: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  return rows.map(toRecord);
}

export async function createRunLog(input: {
  userId: string;
  domain: string;
  scriptName: string;
  scriptId?: string | null;
  mode: string;
  lines: string[];
  startedAt: Date;
}): Promise<ScriptRunLogRecord> {
  const created = await db.scriptRunLog.create({
    data: {
      userId: input.userId,
      domain: input.domain,
      scriptName: input.scriptName,
      scriptId: input.scriptId ?? null,
      mode: input.mode,
      lines: input.lines,
      startedAt: input.startedAt,
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      scriptName: true,
      scriptId: true,
      mode: true,
      lines: true,
      startedAt: true,
      finishedAt: true,
    },
  });

  const keepers = await db.scriptRunLog.findMany({
    where: {
      userId: input.userId,
      domain: input.domain,
    },
    orderBy: {
      startedAt: "desc",
    },
    take: MAX_RUN_LOGS_PER_USER_DOMAIN,
    select: {
      id: true,
    },
  });

  const keepIds = keepers.map((row) => row.id);

  if (keepIds.length > 0) {
    await db.scriptRunLog.deleteMany({
      where: {
        userId: input.userId,
        domain: input.domain,
        id: {
          notIn: keepIds,
        },
      },
    });
  }

  return toRecord(created);
}
