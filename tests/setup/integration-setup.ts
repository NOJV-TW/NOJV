// tests/setup/integration-setup.ts
// Shared beforeEach/afterAll for all integration tests.
// Loaded via vitest setupFiles — no need to import in each test file.
import { afterAll, beforeEach } from "vitest";

import { truncateAllTables, disconnectTestDb } from "../fixtures/seed-test-db";

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await disconnectTestDb();
});
