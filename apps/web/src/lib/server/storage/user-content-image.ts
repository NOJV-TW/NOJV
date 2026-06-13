import {
  createStorageClient,
  downloadUserContentImage as storageDownload,
  uploadUserContentImage as storageUpload,
} from "@nojv/storage";

function userContentImageUrl(userId: string, key: string): string {
  const prefix = `users/${userId}/images/`;
  if (!key.startsWith(prefix)) {
    throw new Error("Stored user content image key did not match the uploading user.");
  }
  const filename = key.slice(prefix.length);
  return `/api/storage/user-content-images/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
}

export async function uploadUserContentImage(
  userId: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const client = createStorageClient();
  const key = await storageUpload(client, userId, buffer, contentType);
  return userContentImageUrl(userId, key);
}

export async function readUserContentImage(userId: string, filename: string) {
  return storageDownload(createStorageClient(), userId, filename);
}
