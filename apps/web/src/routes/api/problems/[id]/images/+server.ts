import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { canEditProblem } from "@nojv/domain";
import { createStorageClient, uploadProblemImage } from "@nojv/storage";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const POST: RequestHandler = async (event) => {
  const actor = requireApiAuth(event);

  if (!canEditProblem(actor.platformRole)) {
    error(403, "Not authorized to edit problems");
  }

  const formData = await event.request.formData();
  const file = formData.get("image");

  if (!(file instanceof File)) {
    error(400, "No image provided");
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    error(400, "Invalid file type. Allowed: png, jpeg, gif, webp");
  }

  if (file.size > MAX_SIZE) {
    error(400, "File too large (max 5MB)");
  }

  const client = createStorageClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadProblemImage(client, event.params.id, buffer, file.type);

  return json({ url });
};
