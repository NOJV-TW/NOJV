import { createStorageClient, uploadProblemImage as storageUpload } from "@nojv/storage";

/**
 * Upload a problem-attached image blob to object storage. Returns the
 * public URL the markdown renderer will reference.
 *
 * Validation (MIME / size / content sniff) is the caller's responsibility
 * — this adapter is intentionally thin and only owns the storage hop.
 */
export async function uploadProblemImage(
  problemId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, problemId, buffer, contentType);
}
