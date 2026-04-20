import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client";

import { parseDatabaseEnv } from "./env";

const globalForPrisma = globalThis as typeof globalThis & {
  __nojvPrisma?: PrismaClient;
};

const environment = parseDatabaseEnv(process.env);
const adapter = new PrismaPg({
  connectionString: environment.DATABASE_URL,
});

export const prisma =
  globalForPrisma.__nojvPrisma ??
  new PrismaClient({
    adapter,
    log: environment.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (environment.NODE_ENV !== "production") {
  globalForPrisma.__nojvPrisma = prisma;
}
