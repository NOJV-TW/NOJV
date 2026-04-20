// tests/setup/global-setup.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/nojv_test";

export default function globalSetup() {
  // Pull S3_*, REDIS_URL, etc. from repo-root `.env` so integration tests
  // can reach the local Garage/Postgres/Redis without hand-duplication.
  // Node 21+ has process.loadEnvFile built-in; repo requires Node 24+.
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  // Force test DB regardless of what `.env` said — integration tests own
  // `nojv_test` and must NOT run against the dev `nojv` database.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;

  // `--accept-data-loss` handles enum drift + column drops between
  // schema generations without needing `--force-reset` every time.
  // Test DB data is ephemeral.
  execSync("pnpm --filter @nojv/db exec prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env },
  });
}
