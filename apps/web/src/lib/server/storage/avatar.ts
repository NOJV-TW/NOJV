import {
  createStorageClient,
  deleteUserAvatar,
  downloadUserAvatar,
  uploadUserAvatar,
} from "@nojv/storage";

import type { ActorContext } from "../auth";
import { createLogger } from "../logger";
import { assertImageFormat, assertImageSize } from "../shared/file-validation";

const logger = createLogger("storage-avatar");

export const MAX_AVATAR_BYTES = 1 * 1024 * 1024;

export async function uploadAvatar(
  actor: ActorContext,
  file: { buffer: Buffer },
): Promise<{ url: string }> {
  assertImageSize(file.buffer, MAX_AVATAR_BYTES);
  assertImageFormat(file.buffer, ["webp"]);

  const client = createStorageClient();
  const key = await uploadUserAvatar(client, actor.userId, file.buffer);
  const filename = key.slice(`avatars/${actor.userId}/`.length);
  const url = `/api/storage/avatars/${encodeURIComponent(actor.userId)}/${encodeURIComponent(filename)}`;
  return { url };
}

export async function deleteAvatar(actor: ActorContext, filename: string): Promise<void> {
  const client = createStorageClient();
  try {
    await deleteUserAvatar(client, actor.userId, filename);
  } catch (err) {
    logger.warn("Avatar storage delete failed", {
      userId: actor.userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readAvatar(userId: string, filename: string): Promise<Buffer> {
  return downloadUserAvatar(createStorageClient(), userId, filename);
}
