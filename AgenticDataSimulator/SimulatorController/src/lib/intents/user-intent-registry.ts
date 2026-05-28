import { db } from "@/lib/db";
import { validateIntentIdForPrometheusClear } from "@/lib/prometheus/client";

export async function registerUserIntent(input: {
  userId: string;
  domain: string;
  intentId: string;
  storage?: string | null;
  graphTargetId?: string | null;
}): Promise<void> {
  const intentId = validateIntentIdForPrometheusClear(input.intentId);
  if (!intentId) {
    throw new Error("intentId must be canonical I + 32 hex characters");
  }

  await db.userIntent.upsert({
    where: {
      userId_intentId: {
        userId: input.userId,
        intentId,
      },
    },
    create: {
      userId: input.userId,
      domain: input.domain,
      intentId,
      storage: input.storage ?? null,
      graphTargetId: input.graphTargetId ?? null,
    },
    update: {
      domain: input.domain,
      ...(input.storage !== undefined ? { storage: input.storage } : {}),
      ...(input.graphTargetId !== undefined ? { graphTargetId: input.graphTargetId } : {}),
    },
  });
}

export async function listOwnedIntentIdsForUser(
  userId: string,
  domain: string,
): Promise<string[]> {
  const rows = await db.userIntent.findMany({
    where: {
      userId,
      domain,
    },
    select: {
      intentId: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return rows.map((row) => row.intentId);
}

export async function assertUserOwnsIntent(userId: string, intentId: string): Promise<boolean> {
  const canonical = validateIntentIdForPrometheusClear(intentId);
  if (!canonical) {
    return false;
  }

  const row = await db.userIntent.findFirst({
    where: {
      userId,
      intentId: canonical,
    },
    select: {
      id: true,
    },
  });

  return row !== null;
}
