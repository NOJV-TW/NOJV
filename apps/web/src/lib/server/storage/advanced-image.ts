import {
  createStorageClient,
  deleteAdvancedImageTarball as storageDelete,
  uploadAdvancedImageTarball as storageUpload,
} from "@nojv/storage";

export async function uploadAdvancedImageTarball(
  problemId: string,
  buffer: Buffer,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, problemId, buffer);
}

export async function deleteAdvancedImageTarball(key: string): Promise<void> {
  const client = createStorageClient();
  await storageDelete(client, key);
}
