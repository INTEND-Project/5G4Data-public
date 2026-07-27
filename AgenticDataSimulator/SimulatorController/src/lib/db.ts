import { PrismaClient } from "@prisma/client";

import { loadAppEnv } from "@/lib/env";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

export function getPrismaClient() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const env = loadAppEnv(process.env);

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: env.databaseUrl,
      },
    },
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
  }

  return prisma;
}

export const db = getPrismaClient();
