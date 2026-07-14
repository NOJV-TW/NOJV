import { afterAll, beforeEach, vi } from "vitest";

import { truncateAllTables, disconnectTestDb } from "../fixtures/seed-test-db";

const { testBlobs } = vi.hoisted(() => ({ testBlobs: new Map<string, Buffer>() }));

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@nojv/storage")>();
  return {
    ...original,
    createStorageClient: () => ({}) as never,
    putText: async (_client: unknown, key: string, content: string) => {
      testBlobs.set(key, Buffer.from(content, "utf8"));
    },
    getText: async (_client: unknown, key: string) => {
      const value = testBlobs.get(key);
      if (value === undefined) {
        throw new Error(`No body returned for object ${key}`);
      }
      return value.toString("utf8");
    },
    putImmutableObject: async (_client: unknown, key: string, body: Buffer) => {
      const pointer = original.storagePointerFor(key, body);
      const existing = testBlobs.get(key);
      if (existing && !existing.equals(body)) {
        throw new original.StorageIntegrityError(key, "immutable key collision");
      }
      testBlobs.set(key, Buffer.from(body));
      return pointer;
    },
    putImmutableText: async (_client: unknown, key: string, content: string) => {
      const body = Buffer.from(content, "utf8");
      const pointer = original.storagePointerFor(key, body);
      const existing = testBlobs.get(key);
      if (existing && !existing.equals(body)) {
        throw new original.StorageIntegrityError(key, "immutable key collision");
      }
      testBlobs.set(key, body);
      return pointer;
    },
    getVerifiedObject: async (_client: unknown, pointer: unknown) => {
      const verified = original.assertStorageObjectPointer(pointer);
      const body = testBlobs.get(verified.key);
      if (!body) throw new Error(`No body returned for object ${verified.key}`);
      const actual = original.storagePointerFor(verified.key, body);
      if (actual.sha256 !== verified.sha256 || actual.size !== verified.size) {
        throw new original.StorageIntegrityError(verified.key, "test object mismatch");
      }
      return Buffer.from(body);
    },
    getVerifiedText: async (_client: unknown, pointer: unknown) => {
      const verified = original.assertStorageObjectPointer(pointer);
      const body = testBlobs.get(verified.key);
      if (!body) throw new Error(`No body returned for object ${verified.key}`);
      const actual = original.storagePointerFor(verified.key, body);
      if (actual.sha256 !== verified.sha256 || actual.size !== verified.size) {
        throw new original.StorageIntegrityError(verified.key, "test object mismatch");
      }
      return body.toString("utf8");
    },
    listByPrefix: async (_client: unknown, prefix: string) => {
      return Array.from(testBlobs.keys()).filter((k) => k.startsWith(prefix));
    },
    sumSizesByPrefix: async (_client: unknown, prefix: string) => {
      let total = 0;
      for (const [key, value] of testBlobs) {
        if (key.startsWith(prefix)) total += value.byteLength;
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
    putSubmissionSourcePlan: async (
      _client: unknown,
      plan: import("@nojv/storage").SubmissionSourcePlan,
    ) => {
      for (const source of plan.sources) {
        testBlobs.set(source.pointer.key, Buffer.from(source.content, "utf8"));
      }
      testBlobs.set(plan.manifest.key, Buffer.from(plan.manifestBody));
      return plan.manifest;
    },
    getSubmissionSources: vi.fn(async (_client: unknown, pointer: unknown) => {
      const verified = original.assertStorageObjectPointer(pointer);
      const manifestBody = testBlobs.get(verified.key);
      if (!manifestBody) throw new Error(`No body returned for object ${verified.key}`);
      const manifest = JSON.parse(manifestBody.toString("utf8")) as {
        sources: { path: string; object: import("@nojv/storage").StorageObjectPointer }[];
      };
      return manifest.sources.map(({ path, object }) => {
        const body = testBlobs.get(object.key);
        if (!body) throw new Error(`No body returned for object ${object.key}`);
        return { path, content: body.toString("utf8") };
      });
    }),
    getSubmissionSourcePointers: async (_client: unknown, pointer: unknown) => {
      const verified = original.assertStorageObjectPointer(pointer);
      const manifestBody = testBlobs.get(verified.key);
      if (!manifestBody) throw new Error(`No body returned for object ${verified.key}`);
      const manifest = JSON.parse(manifestBody.toString("utf8")) as {
        sources: { object: import("@nojv/storage").StorageObjectPointer }[];
      };
      return manifest.sources.map(({ object }) => object);
    },
    putVerdictDetail: async (
      _client: unknown,
      submissionId: string,
      judgeRunId: string,
      detail: unknown,
    ) => {
      const key = original.submissionVerdictDetailKey(submissionId, judgeRunId);
      const body = Buffer.from(JSON.stringify(detail), "utf8");
      testBlobs.set(key, body);
      return original.storagePointerFor(key, body);
    },
    getVerdictDetail: async (_client: unknown, pointer: unknown) => {
      const verified = original.assertStorageObjectPointer(pointer);
      const value = testBlobs.get(verified.key);
      if (!value) throw new Error(`No body returned for object ${verified.key}`);
      return JSON.parse(value.toString("utf8"));
    },
    deleteSubmissionStorage: async (_client: unknown, submissionId: string) => {
      const prefix = `submissions/${submissionId}/`;
      for (const key of Array.from(testBlobs.keys())) if (key.startsWith(prefix)) testBlobs.delete(key);
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
