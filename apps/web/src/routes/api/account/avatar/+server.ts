import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { readFormData, writeApiHandler } from "$lib/server/shared/api-handler";
import { detectImageMime } from "$lib/server/shared/file-validation";
import { deleteAvatar, MAX_AVATAR_BYTES, uploadAvatar } from "$lib/server/storage/avatar";

export const PUT: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const formData = await readFormData(event, MAX_AVATAR_BYTES + 64 * 1024);
  const file = formData.get("file");

  if (!(file instanceof File)) {
    error(400, "No file provided");
  }

  if (file.type !== "image/webp") {
    error(400, "Invalid file type. Avatars must be webp.");
  }

  if (file.size > MAX_AVATAR_BYTES) {
    error(400, "File too large");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (detectImageMime(buffer) !== "image/webp") {
    error(400, "Invalid file content. Avatars must be webp.");
  }
  const { url } = await uploadAvatar(actor, buffer);

  return json({ image: url });
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  await deleteAvatar(actor);

  return new Response(null, { status: 204 });
});
