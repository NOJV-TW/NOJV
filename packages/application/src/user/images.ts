import { randomUUID } from "node:crypto";

import { runTransaction } from "@nojv/db";
import { putImmutableObject, storagePointerFor, userContentImageKey } from "@nojv/storage";

import { ConflictError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import {
  ensureUserContentImageInventory,
  finalizeUploadedImage,
  lockImageUser,
  reserveUploadedImage,
  USER_CONTENT_IMAGE_BUDGET_BYTES,
  validateContentImage,
} from "../shared/uploaded-image";

export async function uploadUserContentImage(
  userId: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  validateContentImage(body, contentType);
  await ensureUserContentImageInventory(userId);
  const pointer = storagePointerFor(
    userContentImageKey(userId, `${randomUUID()}.${contentType.slice("image/".length)}`),
    body,
  );
  const image = await runTransaction(async (tx) => {
    await lockImageUser(tx, userId);
    const usage = await tx.uploadedImage.aggregate({
      where: { userId, kind: "content" },
      _sum: { size: true },
    });
    if ((usage._sum.size ?? 0) + body.length > USER_CONTENT_IMAGE_BUDGET_BYTES)
      throw new ConflictError("Content image storage budget exceeded.");
    return reserveUploadedImage(tx, { pointer, contentType, kind: "content", userId });
  });
  await putImmutableObject(storage(), pointer.key, body, {
    contentType,
    abortSignal: AbortSignal.timeout(60_000),
  });
  await runTransaction(async (tx) => {
    await lockImageUser(tx, userId);
    await finalizeUploadedImage(tx, image.id);
  });
  return pointer.key;
}
