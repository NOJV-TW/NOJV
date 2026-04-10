// tests/setup/global-setup.ts
import { execSync } from "node:child_process";

const DEFAULT_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/nojv_test";

export default function globalSetup() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;

  // `--accept-data-loss` handles enum drift + column drops between
  // schema generations without needing `--force-reset` every time.
  // Test DB data is ephemeral.
  execSync("pnpm --filter @nojv/db exec prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env }
  });
}
