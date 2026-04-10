import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { canEditProblem, problemDomain } from "@nojv/domain";
import { createStorageClient, uploadProblemImage } from "@nojv/storage";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_SIZE = 5 * 1024 * 1024;

function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canEditProblem(actor.platformRole)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId
  );

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

  const detectedType = detectImageType(buffer);
  if (!detectedType || !ALLOWED_TYPES.has(detectedType)) {
    error(400, "Invalid file type. File content does not match an allowed image format.");
  }

  const url = await uploadProblemImage(client, problemId, buffer, detectedType);

  return json({ url });
});
