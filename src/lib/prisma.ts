import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "../generated/prisma/client.js";

type D1Binding = ConstructorParameters<typeof PrismaD1>[0];

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  d1?: D1Binding;
};

export function setPrisma(client: PrismaClient): void {
  globalForPrisma.prisma = client;
}

/** Bind Cloudflare D1 once per isolate so Workers never load better-sqlite3. */
export function ensureD1Prisma(db: D1Binding): PrismaClient {
  if (globalForPrisma.prisma && globalForPrisma.d1 === db) {
    return globalForPrisma.prisma;
  }
  globalForPrisma.d1 = db;
  globalForPrisma.prisma = new PrismaClient({ adapter: new PrismaD1(db) });
  return globalForPrisma.prisma;
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    throw new Error("Prisma client is not initialized");
  }
  return globalForPrisma.prisma;
}

/**
 * Lazy proxy so existing `import { prisma }` call sites keep working.
 * The real client is set in Workers middleware (D1) or the Node bootstrap.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
