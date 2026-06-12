import { afterAll, beforeEach, vi } from "vitest";

import { truncateAllTables, disconnectTestDb } from "../fixtures/seed-test-db";

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

beforeEach(async () => {
  testBlobs.clear();
  await truncateAllTables();
}, 30_000);

afterAll(async () => {
  await disconnectTestDb();
});
