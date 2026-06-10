import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { canCreateProblem, problemDomain } from "@nojv/domain";
import { createLogger } from "$lib/server/logger";
import {
  deleteAdvancedImageTarball,
  uploadAdvancedImageTarball,
} from "$lib/server/storage/advanced-image";

const logger = createLogger("advanced-image-upload");

const { updateProblemRecord } = problemDomain;

const MAX_SIZE = 64 * 1024 * 1024;

function looksLikeTar(buffer: Buffer): boolean {
  if (buffer.length < 512) return false;
  const magic = buffer.subarray(257, 262).toString("utf8");
  return magic === "ustar";
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canCreateProblem(actor.platformRole, actor.emailVerified)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

  const formData = await event.request.formData();
  const file = formData.get("tarball");
  if (!(file instanceof File)) {
    error(400, "No tarball provided");
  }
  if (file.size > MAX_SIZE) {
    error(400, `Tarball too large (max ${String(MAX_SIZE / (1024 * 1024))} MB)`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!looksLikeTar(buffer)) {
    error(400, "File does not look like a tar archive");
  }

  const existing = await problemDomain.getProblemRowById(problemId);
  const previousKey =
    existing?.advancedImageSource === "tarball" ? existing.advancedImageRef : null;

  const key = await uploadAdvancedImageTarball(problemId, buffer);

  await updateProblemRecord(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
    {
      advancedImageSource: "tarball",
      advancedImageRef: key,
    },
  );

  if (previousKey && previousKey !== key) {
    try {
      await deleteAdvancedImageTarball(previousKey);
    } catch (err) {
      logger.warn("Failed to delete superseded advanced-image tarball", {
        problemId,
        previousKey,
        err,
      });
    }
  }

  return json({ key });
});
