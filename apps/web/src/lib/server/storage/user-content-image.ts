import { createStorageClient, uploadUserContentImage as storageUpload } from "@nojv/storage";

export async function uploadUserContentImage(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, userId, buffer, contentType);
}
