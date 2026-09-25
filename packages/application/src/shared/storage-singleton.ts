import { createStorageClient } from "@nojv/storage";

export type StorageClient = ReturnType<typeof createStorageClient>;

let cachedClient: StorageClient | null = null;

export function storage(): StorageClient {
  cachedClient ??= createStorageClient();
  return cachedClient;
}
