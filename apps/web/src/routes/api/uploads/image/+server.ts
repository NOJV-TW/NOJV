import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { readImageUpload } from "$lib/server/image-upload";
import { uploadUserContentImage } from "$lib/server/storage/user-content-image";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { buffer, contentType } = await readImageUpload(event);
  const url = await uploadUserContentImage(actor.userId, buffer, contentType);

  return json({ url });
});
