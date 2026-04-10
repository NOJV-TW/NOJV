import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { canEditProblem, problemDomain } from "@nojv/domain";
import { createStorageClient, uploadAdvancedImageTarball } from "@nojv/storage";

const { updateProblemRecord } = problemDomain;

// Docker image tarballs are typically 50–500 MB. Cap at 2 GB so we
// don't silently accept something that'll blow out the worker.
const MAX_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * Coarse tar sniff — the worker runs a proper `docker load` validation
 * before the image is ever used, so all we need here is a fast reject
 * for obviously-wrong uploads.
 */
function looksLikeTar(buffer: Buffer): boolean {
  if (buffer.length < 512) return false;
  const magic = buffer.subarray(257, 262).toString("utf8");
  return magic === "ustar";
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
  const file = formData.get("tarball");
  if (!(file instanceof File)) {
    error(400, "No tarball provided");
  }
  if (file.size > MAX_SIZE) {
    error(400, `Tarball too large (max ${String(MAX_SIZE / (1024 * 1024 * 1024))} GB)`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!looksLikeTar(buffer)) {
    error(400, "File does not look like a tar archive");
  }

  const client = createStorageClient();
  const key = await uploadAdvancedImageTarball(client, problemId, buffer);

  await updateProblemRecord(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
    {
      advancedImageSource: "tarball",
      advancedImageRef: key
    }
  );

  return json({ key });
});
