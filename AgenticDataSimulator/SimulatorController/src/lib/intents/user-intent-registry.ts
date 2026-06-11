import { db } from "@/lib/db";
import { getPrometheusConnectionStatus } from "@/lib/prometheus/status";
import { listIntentIds, validateIntentIdForPrometheusClear } from "@/lib/prometheus/client";

export async function registerUserIntent(input: {
  userId: string;
  domain: string;
  intentId: string;
  storage?: string | null;
  graphTargetId?: string | null;
  turnId?: string | null;
  mlflowTraceId?: string | null;
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
      turnId: input.turnId ?? null,
      mlflowTraceId: input.mlflowTraceId ?? null,
    },
    update: {
      domain: input.domain,
      ...(input.storage !== undefined ? { storage: input.storage } : {}),
      ...(input.graphTargetId !== undefined ? { graphTargetId: input.graphTargetId } : {}),
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
      ...(input.mlflowTraceId !== undefined ? { mlflowTraceId: input.mlflowTraceId } : {}),
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

/** Drop graph-only registry rows after a KG target is emptied; keep Prometheus-backed intents. */
export async function unregisterGraphStoredIntentsForTarget(
  userId: string,
  graphTargetId: string,
  prometheusBaseUrl?: string | null,
): Promise<void> {
  const rows = await db.userIntent.findMany({
    where: {
      userId,
      graphTargetId,
    },
    select: {
      intentId: true,
      storage: true,
    },
  });

  if (rows.length === 0) {
    return;
  }

  let prometheusIds = new Set<string>();
  if (await getPrometheusConnectionStatus(prometheusBaseUrl)) {
    try {
      prometheusIds = new Set(await listIntentIds(prometheusBaseUrl));
    } catch {
      prometheusIds = new Set();
    }
  }

  const intentIdsToDelete = rows
    .filter((row) => {
      if (row.storage === "prometheus") {
        return false;
      }
      if (row.storage === "graphdb") {
        return true;
      }
      return !prometheusIds.has(row.intentId);
    })
    .map((row) => row.intentId);

  if (intentIdsToDelete.length > 0) {
    await db.userIntent.deleteMany({
      where: {
        userId,
        intentId: {
          in: intentIdsToDelete,
        },
      },
    });
  }

  await db.userIntent.updateMany({
    where: {
      userId,
      graphTargetId,
      storage: "prometheus",
    },
    data: {
      graphTargetId: null,
    },
  });
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
