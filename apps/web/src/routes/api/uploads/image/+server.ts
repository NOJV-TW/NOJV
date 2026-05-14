import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  detectImageType,
} from "$lib/server/shared/image-upload";
import { uploadUserContentImage } from "$lib/server/storage/user-content-image";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const formData = await event.request.formData();
  const file = formData.get("image");

  if (!(file instanceof File)) {
    error(400, "No image provided");
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    error(400, "Invalid file type. Allowed: png, jpeg, gif, webp");
  }

  if (file.size > MAX_IMAGE_SIZE) {
    error(400, "File too large (max 5MB)");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const detectedType = detectImageType(buffer);
  if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
    error(400, "Invalid file type. File content does not match an allowed image format.");
  }

  const url = await uploadUserContentImage(actor.userId, buffer, detectedType);

  return json({ url });
});
