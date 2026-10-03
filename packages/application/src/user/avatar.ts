import { randomUUID } from "node:crypto";

import { prismaAdapterClient, runTransaction } from "@nojv/db";
import {
  putImmutableObject,
  storagePointerFor,
  type StorageObjectPointer,
} from "@nojv/storage";

import { ConflictError, ForbiddenError, ValidationError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { cleanupUnreferencedStorageObject } from "../shared/storage-object-lifecycle";
import {
  avatarImageUrl,
  ensureUserAvatarInventory,
  finalizeUploadedImage,
  lockImageUser,
  reserveUploadedImage,
  retireUploadedImages,
} from "../shared/uploaded-image";

export const MAX_AVATAR_BYTES = 1024 * 1024;

async function inventoryUserAvatars(userId: string): Promise<void> {
  const user = await prismaAdapterClient.user.findUnique({ where: { id: userId } });
  if (!user || user.disabled) throw new ForbiddenError("User is unavailable.");
  const obsolete = await ensureUserAvatarInventory(userId);
  for (const pointer of obsolete) await cleanupUnreferencedStorageObject({ pointer });
}

export async function uploadUserAvatar(
  userId: string,
  body: Buffer,
): Promise<{ url: string; cleanup: StorageObjectPointer[] }> {
  if (
    body.length === 0 ||
    body.length > MAX_AVATAR_BYTES ||
    body.toString("ascii", 0, 4) !== "RIFF" ||
    body.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new ValidationError("Expected a WebP avatar of at most 1 MiB.");
  }
  await inventoryUserAvatars(userId);
  const pointer = storagePointerFor(`avatars/${userId}/${randomUUID()}.webp`, body);
  const image = await runTransaction(async (tx) => {
    await lockImageUser(tx, userId);
    if (await tx.uploadedImage.count({ where: { userId, kind: "avatar", ready: false } })) {
      throw new ConflictError("Previous avatar replacement is awaiting cleanup. Retry later.");
    }
    return reserveUploadedImage(tx, {
      pointer,
      kind: "avatar",
      userId,
      contentType: "image/webp",
    });
  });

  await putImmutableObject(storage(), pointer.key, body, {
    contentType: "image/webp",
    abortSignal: AbortSignal.timeout(60_000),
  });
  return runTransaction(async (tx) => {
    await lockImageUser(tx, userId);
    await finalizeUploadedImage(tx, image.id);
    const previous = await tx.uploadedImage.findMany({
      where: { userId, kind: "avatar", ready: true, id: { not: image.id } },
    });
    await retireUploadedImages(tx, previous);
    const url = avatarImageUrl(userId, pointer.key);
    await tx.user.update({ where: { id: userId }, data: { image: url } });
    return {
      url,
      cleanup: previous.map(({ key, sha256, size }) => ({ key, sha256, size })),
    };
  });
}

export async function removeUserAvatar(userId: string): Promise<StorageObjectPointer[]> {
  await inventoryUserAvatars(userId);
  return runTransaction(async (tx) => {
    await lockImageUser(tx, userId);
    const images = await tx.uploadedImage.findMany({ where: { userId, kind: "avatar" } });
    if (images.some((image) => !image.ready && !image.cleanupStarted)) {
      throw new ConflictError("Avatar replacement is in progress. Retry later.");
    }
    await retireUploadedImages(tx, images);
    await tx.user.update({ where: { id: userId }, data: { image: null } });
    return images.map(({ key, sha256, size }) => ({ key, sha256, size }));
  });
}
