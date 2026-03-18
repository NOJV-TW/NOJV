// tests/setup/global-setup.ts
import { execSync } from "node:child_process";

const DEFAULT_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/nojv_test";

export default function globalSetup() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB_URL;

  execSync("pnpm --filter @nojv/db db:deploy", {
    stdio: "inherit",
    env: { ...process.env }
  });
}
