import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "#lib/server/auth.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";
import { readImageUpload } from "#lib/server/image-upload.js";
import { problemDomain } from "@nojv/application";
import { uploadProblemImage } from "#lib/server/storage/problem-image.js";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(actor, problemId);

  const { buffer, contentType } = await readImageUpload(event);
  const url = await uploadProblemImage(actor, problemId, buffer, contentType);

  return Response.json({ url });
});
