import {
  cacheRemoteImage as storageCache,
  createStorageClient,
  downloadRemoteImage as storageDownload,
  isStorageObjectNotFoundError,
} from "@nojv/storage";

let client: ReturnType<typeof createStorageClient> | undefined;

function storageClient(): ReturnType<typeof createStorageClient> {
  return (client ??= createStorageClient());
}

export async function readCachedRemoteImage(url: string) {
  try {
    return await storageDownload(storageClient(), url);
  } catch (reason) {
    if (isStorageObjectNotFoundError(reason)) return null;
    throw reason;
  }
}

export function cacheRemoteImage(url: string, body: Buffer, contentType: string) {
  return storageCache(storageClient(), url, body, contentType);
}
