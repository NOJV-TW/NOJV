// tests/setup/integration-setup.ts
// Shared beforeEach/afterAll for all integration tests.
// Loaded via vitest setupFiles — no need to import in each test file.
import { afterAll, beforeEach } from "vitest";

import { truncateAllTables, disconnectTestDb } from "../fixtures/seed-test-db";

// Generous 30s hook timeout: integration tests share one Postgres +
// connection pool, and the full-suite run has shown TRUNCATE CASCADE
// waiting on pool contention across serial files (the default 10s is
// occasionally too tight). 30s is still fast enough to flag a real
// deadlock as a failure rather than a hang.
beforeEach(async () => {
  await truncateAllTables();
}, 30_000);

afterAll(async () => {
  await disconnectTestDb();
});
