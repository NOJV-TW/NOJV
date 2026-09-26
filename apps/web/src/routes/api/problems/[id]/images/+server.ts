import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { readUploadedImage } from "$lib/server/shared/file-validation";
import { problemDomain } from "@nojv/application";
import { uploadProblemImage } from "$lib/server/storage/problem-image";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(actor, problemId);

  const { buffer, contentType } = await readUploadedImage(await event.request.formData());
  const url = await uploadProblemImage(actor, problemId, buffer, contentType);

  return json({ url });
});
