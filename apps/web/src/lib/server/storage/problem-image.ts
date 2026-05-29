import { createStorageClient, uploadProblemImage as storageUpload } from "@nojv/storage";

export async function uploadProblemImage(
  problemId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, problemId, buffer, contentType);
}
