// tests/setup/integration-setup.ts
// Shared beforeEach/afterAll for all integration tests.
// Loaded via vitest setupFiles — no need to import in each test file.
import { afterAll, beforeEach, vi } from "vitest";

import { truncateAllTables, disconnectTestDb } from "../fixtures/seed-test-db";

// Stub @nojv/storage for integration tests. The suite's job is to verify
// domain/query correctness against a real Postgres; S3 is an incidental
// implementation detail. An in-memory Map is indistinguishable from real
// S3 for the tests' assertions and removes the need for any S3 backend
// (real MinIO/LocalStack) in CI or local dev.
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
    listByPrefix: async (_client: unknown, prefix: string) => {
      return Array.from(testBlobs.keys()).filter((k) => k.startsWith(prefix));
    },
    sumSizesByPrefix: async (_client: unknown, prefix: string) => {
      let total = 0;
      for (const [key, value] of testBlobs) {
        if (key.startsWith(prefix)) total += Buffer.byteLength(value, "utf-8");
      }
      return total;
    },
    deleteBlob: async (_client: unknown, key: string) => {
      testBlobs.delete(key);
    },
    deleteBlobsByPrefix: async (_client: unknown, prefix: string) => {
      for (const key of Array.from(testBlobs.keys())) {
        if (key.startsWith(prefix)) testBlobs.delete(key);
      }
    },
    // The submission helpers call their own module-local putText/getText/listByPrefix
    // bindings; vi.mock only rewrites the @nojv/storage barrel exports, so we
    // re-implement the helpers directly against testBlobs.
    putSubmissionSources: async (
      _client: unknown,
      submissionId: string,
      sources: readonly { path: string; content: string }[],
    ) => {
      for (const s of sources) {
        testBlobs.set(`submissions/${submissionId}/sources/${s.path}`, s.content);
      }
    },
    getSubmissionSources: async (_client: unknown, submissionId: string) => {
      const prefix = `submissions/${submissionId}/sources/`;
      const keys = Array.from(testBlobs.keys())
        .filter((k) => k.startsWith(prefix))
        .sort((a, b) => Number(a > b) - Number(a < b));
      return keys.map((key) => ({
        path: key.slice(prefix.length),
        content: testBlobs.get(key)!,
      }));
    },
    putVerdictDetail: async (_client: unknown, submissionId: string, detail: unknown) => {
      testBlobs.set(`submissions/${submissionId}/verdict-detail.json`, JSON.stringify(detail));
    },
    getVerdictDetail: async (_client: unknown, submissionId: string) => {
      const v = testBlobs.get(`submissions/${submissionId}/verdict-detail.json`);
      return v === undefined ? null : JSON.parse(v);
    },
    deleteSubmissionStorage: async (_client: unknown, submissionId: string) => {
      const prefix = `submissions/${submissionId}/`;
      for (const k of Array.from(testBlobs.keys())) {
        if (k.startsWith(prefix)) testBlobs.delete(k);
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
