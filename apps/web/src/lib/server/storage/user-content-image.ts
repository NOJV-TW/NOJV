import { createStorageClient, uploadUserContentImage as storageUpload } from "@nojv/storage";

/**
 * Upload an image attached to general user-authored content (problem
 * statements, editorials, discussion posts, etc.) and return the public
 * URL. The caller owns MIME / size validation.
 */
export async function uploadUserContentImage(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, userId, buffer, contentType);
}
