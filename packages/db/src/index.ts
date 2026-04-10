import { Prisma } from "../generated/prisma/client";

export * from "./repositories";
export { runTransaction, type TransactionClient } from "./transaction";

// `prismaAdapterClient` is for framework adapters (e.g. better-auth) that
// require the raw PrismaClient — application code should use repositories.
export { prisma as prismaAdapterClient } from "./client";
export { Prisma };
