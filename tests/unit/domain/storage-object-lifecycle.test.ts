import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as StorageModule from "@nojv/storage";

const { deleteBlob, getVerifiedObject, getSubmissionSourcePointers, queryRaw } = vi.hoisted(
  () => ({
    deleteBlob: vi.fn(),
    getVerifiedObject: vi.fn(),
    getSubmissionSourcePointers: vi.fn(),
    queryRaw: vi.fn(),
  }),
);

vi.mock("@nojv/db", () => ({
  DurableWorkInvariantError: class DurableWorkInvariantError extends Error {},
  durableWorkRepo: {},
  prismaAdapterClient: { $queryRaw: queryRaw },
}));

vi.mock("@nojv/storage", async (importOriginal) => {
  const original = await importOriginal<typeof StorageModule>();
  return {
    ...original,
    deleteBlob,
    getVerifiedObject,
    getSubmissionSourcePointers,
  };
});

vi.mock("../../../packages/application/src/shared/storage-singleton", () => ({
  storage: () => ({}),
}));

import { cleanupUnreferencedStorageObject } from "../../../packages/application/src/shared/storage-object-lifecycle";

function pointer(key: string, body = Buffer.from("body")) {
  return {
    key,
    sha256: createHash("sha256").update(body).digest("hex"),
    size: body.byteLength,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue([{ referenced: false }]);
  getVerifiedObject.mockResolvedValue(Buffer.from("body"));
  getSubmissionSourcePointers.mockResolvedValue([]);
  deleteBlob.mockResolvedValue(undefined);
});

describe("storage object cleanup", () => {
  it("treats only a missing object as successful cleanup", async () => {
    const missing = new Error("missing");
    missing.name = "NoSuchKey";
    getVerifiedObject.mockRejectedValue(missing);

    await expect(
      cleanupUnreferencedStorageObject({ pointer: pointer("objects/v1") }),
    ).resolves.toBeUndefined();
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("propagates exact-key delete failures for durable retry", async () => {
    deleteBlob.mockRejectedValueOnce(new Error("AccessDenied"));

    await expect(
      cleanupUnreferencedStorageObject({ pointer: pointer("objects/v1") }),
    ).rejects.toThrow("AccessDenied");
    expect(deleteBlob).toHaveBeenCalledWith({}, "objects/v1");
  });

  it("does not delete a pointer that is still referenced", async () => {
    queryRaw.mockResolvedValue([{ referenced: true }]);
    await cleanupUnreferencedStorageObject({ pointer: pointer("objects/v1") });
    expect(getVerifiedObject).not.toHaveBeenCalled();
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("verifies and deletes source children by exact key before their manifest", async () => {
    const manifest = pointer("submissions/sub_1/source-generations/gen_1/manifest.json");
    const child = pointer("submissions/sub_1/source-generations/gen_1/files/main.cpp");
    getSubmissionSourcePointers.mockResolvedValue([child]);

    await cleanupUnreferencedStorageObject({ pointer: manifest });

    expect(getVerifiedObject).toHaveBeenCalledWith({}, child);
    expect(deleteBlob.mock.calls).toEqual([
      [{}, child.key],
      [{}, manifest.key],
    ]);
  });
});
