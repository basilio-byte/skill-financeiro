import "server-only";
import { PrismaClient } from "@prisma/client";

/**
 * Singleton do PrismaClient — evita esgotar conexões em dev (hot reload
 * do Next recriaria o client a cada mudança de arquivo sem isso).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
