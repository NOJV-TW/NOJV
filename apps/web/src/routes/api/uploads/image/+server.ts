import type { RequestHandler } from "./$types";
import { requireApiAuth } from "#lib/server/auth.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";
import { readImageUpload } from "#lib/server/image-upload.js";
import { uploadUserContentImage } from "#lib/server/storage/user-content-image.js";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { buffer, contentType } = await readImageUpload(event);
  const url = await uploadUserContentImage(actor.userId, buffer, contentType);

  return Response.json({ url });
});
