import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
  detectImageType,
} from "$lib/server/shared/image-upload";
import { canEditProblem, problemDomain } from "@nojv/domain";
import { createStorageClient, uploadProblemImage } from "@nojv/storage";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canEditProblem(actor.platformRole)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

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

  const client = createStorageClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const detectedType = detectImageType(buffer);
  if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType)) {
    error(400, "Invalid file type. File content does not match an allowed image format.");
  }

  const url = await uploadProblemImage(client, problemId, buffer, detectedType);

  return json({ url });
});
