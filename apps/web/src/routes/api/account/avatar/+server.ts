import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { userDomain } from "@nojv/domain";
import { createStorageClient, deleteUserAvatar, uploadUserAvatar } from "@nojv/storage";

import { requireApiAuth } from "$lib/server/auth";
import { createLogger } from "$lib/server/logger";
import { writeApiHandler } from "$lib/server/shared/api-handler";

const logger = createLogger("account-avatar");

// Cropper outputs 512x512 webp at q=0.9 — well under 1 MB in practice.
const MAX_SIZE = 1 * 1024 * 1024;

function isWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return (
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  );
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const formData = await event.request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    error(400, "No file provided");
  }

  if (file.size > MAX_SIZE) {
    error(400, "File too large");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!isWebp(buffer)) {
    error(400, "Invalid file type. Only WebP is accepted.");
  }

  const client = createStorageClient();
  const url = await uploadUserAvatar(client, actor.userId, buffer);
  await userDomain.setUserAvatar(actor.userId, url);

  return json({ image: url });
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const client = createStorageClient();
  try {
    await deleteUserAvatar(client, actor.userId);
  } catch (err) {
    // Best-effort: storage delete may fail (already gone, transient), but
    // we still want to clear the DB pointer so the user sees the avatar removed.
    logger.warn("Avatar storage delete failed", {
      userId: actor.userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  await userDomain.setUserAvatar(actor.userId, null);

  return json({ ok: true });
});
