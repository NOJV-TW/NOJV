import { runTransaction } from "@nojv/db";
import { deleteBlob, uploadProblemImage as storageUpload } from "@nojv/storage";

import { ValidationError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import {
  assertProblemEditAccess,
  lockProblemForEdit,
  type ProblemActorContext,
} from "./permissions";

export async function uploadProblemImage(
  actor: ProblemActorContext,
  problemId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType) ||
    buffer.length === 0 ||
    buffer.length > 5 * 1024 * 1024
  ) {
    throw new ValidationError("Expected an image of at most 5 MB.");
  }
  await assertProblemEditAccess(actor, problemId);
  const client = storage();
  const key = await storageUpload(client, problemId, buffer, contentType);
  try {
    await runTransaction(async (tx) => {
      await lockProblemForEdit(tx, actor, problemId);
    });
  } catch (error) {
    await deleteBlob(client, key);
    throw error;
  }
  return key;
}
