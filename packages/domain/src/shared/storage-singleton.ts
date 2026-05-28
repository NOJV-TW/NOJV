import { createStorageClient } from "@nojv/storage";

// Inferred to keep @aws-sdk/client-s3 out of @nojv/domain's public surface.
export type StorageClient = ReturnType<typeof createStorageClient>;

let cachedClient: StorageClient | null = null;

/**
 * Process-wide lazy singleton for the S3-compatible storage client.
 * Tests stub the underlying call sites (or substitute the client) rather
 * than instantiating this; production code paths share a single client so
 * the SDK can pool HTTP connections.
 */
export function storage(): StorageClient {
  cachedClient ??= createStorageClient();
  return cachedClient;
}

/** Test-only seam: inject a stubbed client and bypass `createStorageClient`. */
export function __setStorageClientForTests(client: StorageClient | null): void {
  cachedClient = client;
}
