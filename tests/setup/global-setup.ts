import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveDestructiveTestDatabase } from "./destructive-test-database";
import { rebuildTestDatabaseFromMigrations } from "./migrate-test-database";

export default async function globalSetup() {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const databaseUrl = resolveDestructiveTestDatabase("nojv_test");
  process.env.DATABASE_URL = databaseUrl;

  await rebuildTestDatabaseFromMigrations(databaseUrl, "nojv_test", process.env);
}
