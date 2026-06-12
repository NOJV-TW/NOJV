import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../packages/db/generated/prisma/client";
import { collectReplayStatements } from "./replay-constraints";

const DEFAULT_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/nojv_test";

export default async function globalSetup() {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;

  execSync("pnpm --filter @nojv/db exec prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env },
  });

  const statements = collectReplayStatements();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }
  } finally {
    await prisma.$disconnect();
  }
}
