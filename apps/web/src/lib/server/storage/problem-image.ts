import { problemDomain, type ActorContext } from "@nojv/application";
import { createStorageClient, downloadProblemImage as storageDownload } from "@nojv/storage";

function problemImageUrl(problemId: string, key: string): string {
  const prefix = `problems/${problemId}/images/`;
  if (!key.startsWith(prefix)) {
    throw new Error("Stored problem image key did not match the requested problem.");
  }
  const filename = key.slice(prefix.length);
  return `/api/storage/problem-images/${encodeURIComponent(problemId)}/${encodeURIComponent(filename)}`;
}

export async function uploadProblemImage(
  actor: ActorContext,
  problemId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const key = await problemDomain.uploadProblemImage(actor, problemId, buffer, contentType);
  return problemImageUrl(problemId, key);
}

export async function readProblemImage(problemId: string, filename: string) {
  return storageDownload(createStorageClient(), problemId, filename);
}
