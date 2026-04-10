// tests/setup/global-setup.ts
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/nojv_test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function globalSetup() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;

  // `--accept-data-loss` handles enum drift + column drops between
  // schema generations without needing `--force-reset` every time.
  // Test DB data is ephemeral anyway.
  execSync("pnpm --filter @nojv/db exec prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env }
  });

  // Apply DB-level constraints Prisma can't express (CHECK + GIN index).
  // Uses the Prisma client directly so it works without a psql binary on
  // PATH. Idempotent: the script skips constraints/indexes that exist.
  const applyScript = path.join(__dirname, "apply-db-constraints.ts");
  execSync(`pnpm tsx ${applyScript}`, {
    stdio: "inherit",
    env: { ...process.env }
  });
}
