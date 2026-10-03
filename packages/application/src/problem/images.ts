import { randomUUID } from "node:crypto";

import { runTransaction } from "@nojv/db";
import { problemImageKey, putImmutableObject, storagePointerFor } from "@nojv/storage";

import { storage } from "../shared/storage-singleton";
import {
  ensureProblemImageInventory,
  finalizeUploadedImage,
  reserveUploadedImage,
  validateContentImage,
} from "../shared/uploaded-image";
import { assertProblemStorageBudget } from "./storage-budget";
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
  validateContentImage(buffer, contentType);
  await assertProblemEditAccess(actor, problemId);
  await ensureProblemImageInventory(problemId);
  const pointer = storagePointerFor(
    problemImageKey(problemId, `${randomUUID()}.${contentType.slice("image/".length)}`),
    buffer,
  );
  const image = await runTransaction(async (tx) => {
    await lockProblemForEdit(tx, actor, problemId);
    await assertProblemStorageBudget(problemId, buffer.length, tx);
    return reserveUploadedImage(tx, { pointer, contentType, kind: "problem", problemId });
  });
  await putImmutableObject(storage(), pointer.key, buffer, {
    contentType,
    abortSignal: AbortSignal.timeout(60_000),
  });
  await runTransaction(async (tx) => {
    await lockProblemForEdit(tx, actor, problemId);
    await finalizeUploadedImage(tx, image.id);
  });
  return pointer.key;
}
