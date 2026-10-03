import { describe, expect, it, vi } from "vitest";
import { cleanupUnreferencedStorageObject, userDomain } from "@nojv/application";
import { prismaAdapterClient as db } from "@nojv/db";
import * as objects from "@nojv/storage";

import { createTestUser } from "../../fixtures/factories";

function avatar(value = "first"): Buffer {
  return Buffer.from(`RIFF0000WEBP${value}`);
}

describe("owned avatar lifecycle", () => {
  it("rejects invalid and oversized avatars before reserving storage", async () => {
    const user = await createTestUser();
    await expect(userDomain.uploadUserAvatar(user.id, Buffer.from("not-webp"))).rejects.toThrow(
      "WebP",
    );
    await expect(
      userDomain.uploadUserAvatar(user.id, Buffer.alloc(1024 * 1024 + 1)),
    ).rejects.toThrow("1 MiB");
    expect(await db.uploadedImage.count()).toBe(0);
  });

  it("keeps the current version and bounds replacements until old-object cleanup succeeds", async () => {
    const user = await createTestUser();
    const first = await userDomain.uploadUserAvatar(user.id, avatar());
    const next = await userDomain.uploadUserAvatar(user.id, avatar("second"));
    expect(first.cleanup).toEqual([]);
    expect(next.cleanup).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).image).toBe(next.url);
    await expect(userDomain.uploadUserAvatar(user.id, avatar("third"))).rejects.toThrow(
      "awaiting cleanup",
    );
    await cleanupUnreferencedStorageObject({ pointer: next.cleanup[0] });
    expect(await db.uploadedImage.count({ where: { userId: user.id, kind: "avatar" } })).toBe(
      1,
    );
    const third = await userDomain.uploadUserAvatar(user.id, avatar("third"));
    expect(third.cleanup).toHaveLength(1);
  });

  it("allows only one simultaneous upload to reserve capacity", async () => {
    const user = await createTestUser({ avatarInventoryComplete: true });
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const allowed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = objects.putImmutableObject;
    const write = vi
      .spyOn(objects, "putImmutableObject")
      .mockImplementation(async (...args) => {
        entered();
        await allowed;
        return original(...args);
      });
    const first = userDomain.uploadUserAvatar(user.id, avatar("one"));
    await writing;
    const results = await Promise.allSettled([
      userDomain.uploadUserAvatar(user.id, avatar("two")),
      userDomain.uploadUserAvatar(user.id, avatar("three")),
    ]);
    release();
    await first;
    write.mockRestore();
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(await db.uploadedImage.count({ where: { userId: user.id, ready: false } })).toBe(0);
    expect(await db.uploadedImage.count({ where: { userId: user.id, ready: true } })).toBe(1);
  });

  it("reclaims legacy versions while preserving the current legacy avatar", async () => {
    const user = await createTestUser();
    const currentKey = `avatars/${user.id}/current.webp`;
    const oldKey = `avatars/${user.id}/obsolete.webp`;
    await objects.putImmutableObject(objects.createStorageClient(), currentKey, avatar());
    await objects.putImmutableObject(objects.createStorageClient(), oldKey, avatar("old"));
    await db.user.update({
      where: { id: user.id },
      data: { image: `/api/storage/avatars/${user.id}/current.webp` },
    });
    const uploaded = await userDomain.uploadUserAvatar(user.id, avatar("new"));
    expect(uploaded.cleanup.map(({ key }) => key)).toEqual([currentKey]);
    expect(await db.uploadedImage.count({ where: { key: oldKey } })).toBe(0);
    expect(
      await objects.listByPrefix(objects.createStorageClient(), `avatars/${user.id}/`),
    ).not.toContain(oldKey);
  });

  it("clears the current pointer before deleting its object", async () => {
    const user = await createTestUser();
    await userDomain.uploadUserAvatar(user.id, avatar());
    const cleanup = await userDomain.removeUserAvatar(user.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).image).toBeNull();
    expect(await db.uploadedImage.count({ where: { userId: user.id } })).toBe(1);
    await cleanupUnreferencedStorageObject({ pointer: cleanup[0] });
    expect(await db.uploadedImage.count({ where: { userId: user.id } })).toBe(0);
  });

  it("retains the reservation when object deletion fails", async () => {
    const user = await createTestUser();
    await userDomain.uploadUserAvatar(user.id, avatar());
    const next = await userDomain.uploadUserAvatar(user.id, avatar("next"));
    const deletion = vi
      .spyOn(objects, "deleteBlob")
      .mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(
      cleanupUnreferencedStorageObject({ pointer: next.cleanup[0] }),
    ).rejects.toThrow("AccessDenied");
    deletion.mockRestore();
    expect(await db.uploadedImage.count({ where: { userId: user.id, ready: false } })).toBe(1);
    await expect(userDomain.uploadUserAvatar(user.id, avatar("third"))).rejects.toThrow(
      "awaiting cleanup",
    );
    await cleanupUnreferencedStorageObject({ pointer: next.cleanup[0] });
    await expect(userDomain.uploadUserAvatar(user.id, avatar("third"))).resolves.toHaveProperty(
      "url",
    );
  });
});
