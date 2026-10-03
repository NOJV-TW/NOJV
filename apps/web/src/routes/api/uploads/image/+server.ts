import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { readFormData, writeApiHandler } from "$lib/server/shared/api-handler";
import { MAX_IMAGE_SIZE, readUploadedImage } from "$lib/server/shared/file-validation";
import { uploadUserContentImage } from "$lib/server/storage/user-content-image";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { buffer, contentType } = await readUploadedImage(
    await readFormData(event, MAX_IMAGE_SIZE + 64 * 1024),
  );
  const url = await uploadUserContentImage(actor.userId, buffer, contentType);

  return json({ url });
});
