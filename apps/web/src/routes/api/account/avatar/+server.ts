import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { userDomain } from "@nojv/domain";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { deleteAvatar, MAX_AVATAR_BYTES, uploadAvatar } from "$lib/server/storage/avatar";

// PUT /api/account/avatar — replace (or create) the caller's avatar from
// the multipart `file` field. Returns `{ image }` with the new URL.
export const PUT: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const formData = await event.request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    error(400, "No file provided");
  }

  if (file.size > MAX_AVATAR_BYTES) {
    error(400, "File too large");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url } = await uploadAvatar(actor, { buffer });
  await userDomain.setUserAvatar(actor.userId, url);

  return json({ image: url });
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  await deleteAvatar(actor);
  await userDomain.setUserAvatar(actor.userId, null);

  return json({ ok: true });
});
