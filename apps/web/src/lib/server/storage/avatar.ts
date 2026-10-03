import { cleanupUnreferencedStorageObject, userDomain } from "@nojv/application";
import {
  createStorageClient,
  downloadUserAvatar,
  type StorageObjectPointer,
} from "@nojv/storage";

import type { ActorContext } from "../auth";
import { createLogger } from "../logger";

const logger = createLogger("storage-avatar");

export const MAX_AVATAR_BYTES = userDomain.MAX_AVATAR_BYTES;

export async function uploadAvatar(
  actor: ActorContext,
  buffer: Buffer,
): Promise<{ url: string }> {
  const { url, cleanup } = await userDomain.uploadUserAvatar(actor.userId, buffer);
  await cleanAvatars(actor, cleanup);
  return { url };
}

async function cleanAvatars(
  actor: ActorContext,
  pointers: readonly StorageObjectPointer[],
): Promise<void> {
  for (const pointer of pointers) {
    try {
      await cleanupUnreferencedStorageObject({ pointer });
    } catch (err) {
      logger.warn("Avatar cleanup queued for retry", {
        userId: actor.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function deleteAvatar(actor: ActorContext): Promise<void> {
  await cleanAvatars(actor, await userDomain.removeUserAvatar(actor.userId));
}

export async function readAvatar(userId: string, filename: string): Promise<Buffer> {
  return downloadUserAvatar(createStorageClient(), userId, filename);
}
