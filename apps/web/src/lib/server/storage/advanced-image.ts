import {
  createStorageClient,
  uploadAdvancedImageTarball as storageUpload,
} from "@nojv/storage";

/**
 * Stream a TA-supplied advanced-judge image tarball into object storage
 * and return the storage key. The worker's advanced-mode executor will
 * later `docker load` it on first use.
 *
 * The caller is responsible for size and tar-format validation — this
 * adapter owns only the storage hop.
 */
export async function uploadAdvancedImageTarball(
  problemId: string,
  buffer: Buffer,
): Promise<string> {
  const client = createStorageClient();
  return storageUpload(client, problemId, buffer);
}
