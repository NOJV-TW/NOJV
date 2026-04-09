import { Prisma } from "../generated/prisma/client";

// Repositories (preferred access method)
export * from "./repositories";
export { runTransaction, type TransactionClient } from "./transaction";

// Infrastructure-only: for framework adapters (e.g. better-auth) that require raw PrismaClient.
// NOT for business logic — use repositories instead.
export { prisma as prismaAdapterClient } from "./client";
// Prisma namespace: exported as a runtime value so callers can use
// `Prisma.JsonNull`/`Prisma.DbNull` alongside the existing type access
// (`Prisma.ProblemWhereInput`, etc.).
export { Prisma };
