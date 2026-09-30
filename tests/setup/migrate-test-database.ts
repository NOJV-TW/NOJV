import { execFileSync } from "node:child_process";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../packages/db/generated/prisma/client";
import {
  assertLiveTestDatabase,
  formatTestDatabaseProof,
  type DestructiveTestDatabase,
} from "./destructive-test-database";

export async function rebuildTestDatabaseFromMigrations(
  databaseUrl: string,
  expectedDatabase: DestructiveTestDatabase,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await prisma.$transaction(async (tx) => {
      const proof = await assertLiveTestDatabase(tx, expectedDatabase);
      console.info(`Schema reset database proof: ${formatTestDatabaseProof(proof)}`);
      await tx.$executeRawUnsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
      await tx.$executeRawUnsafe('CREATE SCHEMA "public"');
    });
  } finally {
    await prisma.$disconnect();
  }

  execFileSync("pnpm", ["--filter", "@nojv/db", "exec", "prisma", "migrate", "deploy"], {
    env: { ...env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
