import type { Prisma } from "../generated/prisma/client";

// Repositories (preferred access method)
export * from "./repositories";
export { runTransaction, type TransactionClient } from "./transaction";

// Infrastructure-only: for framework adapters (e.g. better-auth) that require raw PrismaClient.
// NOT for business logic — use repositories instead.
export { prisma as prismaAdapterClient } from "./client";
export type { Prisma };
