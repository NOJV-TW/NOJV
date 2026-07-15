import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../packages/db/generated/prisma/client";
import {
  assertLiveTestDatabase,
  formatTestDatabaseProof,
  resolveDestructiveTestDatabase,
} from "./destructive-test-database";
import { collectReplayStatements } from "./replay-constraints";

export default async function globalSetup() {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const databaseUrl = resolveDestructiveTestDatabase("nojv_test");
  process.env.DATABASE_URL = databaseUrl;

  const preflight = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const proof = await assertLiveTestDatabase(preflight, "nojv_test");
    console.info(`Destructive test database preflight: ${formatTestDatabaseProof(proof)}`);
  } finally {
    await preflight.$disconnect();
  }

  execFileSync(
    "pnpm",
    ["--filter", "@nojv/db", "exec", "prisma", "db", "push", "--accept-data-loss"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );

  const statements = collectReplayStatements();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    await prisma.$transaction(async (tx) => {
      const proof = await assertLiveTestDatabase(tx, "nojv_test");
      console.info(`Constraint replay database proof: ${formatTestDatabaseProof(proof)}`);
      for (const stmt of statements) {
        await tx.$executeRawUnsafe(stmt);
      }
    });
  } finally {
    await prisma.$disconnect();
  }
}
