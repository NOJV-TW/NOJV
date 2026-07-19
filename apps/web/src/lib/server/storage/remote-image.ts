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

export function readRemoteImage(url: string) {
  return storageDownload(storageClient(), url);
}

export function cacheRemoteImage(url: string, body: Buffer, contentType: string) {
  return storageCache(storageClient(), url, body, contentType);
}

export function isRemoteImageNotFoundError(reason: unknown): boolean {
  return isStorageObjectNotFoundError(reason);
}
