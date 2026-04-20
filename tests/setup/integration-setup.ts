// tests/setup/integration-setup.ts
// Shared beforeEach/afterAll for all integration tests.
// Loaded via vitest setupFiles — no need to import in each test file.
import { afterAll, beforeEach, vi } from "vitest";

import { truncateAllTables, disconnectTestDb } from "../fixtures/seed-test-db";

// Stub @nojv/storage for integration tests. The suite's job is to verify
// domain/query correctness against a real Postgres; S3 is an incidental
// implementation detail. An in-memory Map is indistinguishable from real
// S3 for the tests' assertions and removes the need for any S3 backend
// (real MinIO/Garage/LocalStack) in CI or local dev.
//
// `vi.hoisted` ensures `testBlobs` is declared alongside the hoisted
// `vi.mock` call, so both the mock factory closure and the beforeEach
// reset below see the same Map instance.
const { testBlobs } = vi.hoisted(() => ({ testBlobs: new Map<string, string>() }));

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@nojv/storage")>();
  return {
    ...original,
    createStorageClient: () => ({}) as never,
    putText: async (_client: unknown, key: string, content: string) => {
      testBlobs.set(key, content);
    },
    getText: async (_client: unknown, key: string) => {
      const value = testBlobs.get(key);
      if (value === undefined) {
        throw new Error(`No body returned for object ${key}`);
      }
      return value;
    },
    deleteBlob: async (_client: unknown, key: string) => {
      testBlobs.delete(key);
    },
    deleteBlobsByPrefix: async (_client: unknown, prefix: string) => {
      for (const key of Array.from(testBlobs.keys())) {
        if (key.startsWith(prefix)) testBlobs.delete(key);
      }
    },
  };
});

// Generous 30s hook timeout: integration tests share one Postgres +
// connection pool, and the full-suite run has shown TRUNCATE CASCADE
// waiting on pool contention across serial files (the default 10s is
// occasionally too tight). 30s is still fast enough to flag a real
// deadlock as a failure rather than a hang.
beforeEach(async () => {
  testBlobs.clear();
  await truncateAllTables();
}, 30_000);

afterAll(async () => {
  await disconnectTestDb();
});
