import {
  createStorageClient,
  deleteAdvancedImageTarball as storageDelete,
  uploadAdvancedImageTarball as storageUpload,
  type AdvancedImageRole,
} from "@nojv/storage";

export type { AdvancedImageRole };

export async function uploadAdvancedImageTarball(
  problemId: string,
  role: AdvancedImageRole,
  buffer: Buffer,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, problemId, role, buffer);
}

export async function deleteAdvancedImageTarball(key: string): Promise<void> {
  const client = createStorageClient();
  await storageDelete(client, key);
}
