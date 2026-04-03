import { prisma } from "./client";
import type { Prisma } from "../generated/prisma/client";

export type TransactionClient = Prisma.TransactionClient;

export function runTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
