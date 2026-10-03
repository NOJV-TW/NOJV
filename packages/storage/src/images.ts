import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { parseRelativePath } from "@nojv/core";

import { getStorageEnv } from "./env";
import {
  isStorageObjectNotFoundError,
  storagePointerFor,
  type StorageObjectPointer,
} from "./object";
import { listByPrefix } from "./blobs";

let cachedBucket: string | undefined;
function BUCKET(): string {
  cachedBucket ??= getStorageEnv().S3_BUCKET;
  return cachedBucket;
}

export interface StoredImage {
  body: Buffer;
  contentType: string;
}

function imageFilename(filename: string): string {
  const parsed = parseRelativePath(filename);
  if (parsed.includes("/")) {
    throw new Error("Image filename must not contain path separators");
  }
  return parsed;
}

async function readObject(
  client: S3Client,
  key: string,
  abortSignal?: AbortSignal,
): Promise<StoredImage> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    }),
    abortSignal ? { abortSignal } : undefined,
  );
  const maxBytes = 5 * 1024 * 1024;
  if (response.ContentLength !== undefined && response.ContentLength > maxBytes)
    throw new Error(`Image ${key} exceeds 5 MiB.`);
  const body = response.Body;
  if (!body) {
    throw new Error(`No body returned for object ${key}`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`Image ${key} exceeds 5 MiB.`);
    chunks.push(chunk);
  }
  return {
    body: Buffer.concat(chunks),
    contentType: response.ContentType ?? "application/octet-stream",
  };
}

export async function downloadProblemImage(
  client: S3Client,
  problemId: string,
  filename: string,
): Promise<StoredImage> {
  return readObject(client, `problems/${problemId}/images/${imageFilename(filename)}`);
}

export async function downloadUserContentImage(
  client: S3Client,
  userId: string,
  filename: string,
): Promise<StoredImage> {
  return readObject(client, `users/${userId}/images/${imageFilename(filename)}`);
}

export async function readImageObjectInventory(
  client: S3Client,
  keys: readonly string[],
  abortSignal = AbortSignal.timeout(60_000),
): Promise<{ pointer: StorageObjectPointer; contentType: string }[]> {
  const result: { pointer: StorageObjectPointer; contentType: string }[] = [];
  for (const key of new Set(keys)) {
    try {
      const image = await readObject(client, key, abortSignal);
      result.push({
        pointer: storagePointerFor(key, image.body),
        contentType: image.contentType,
      });
    } catch (reason) {
      if (!isStorageObjectNotFoundError(reason)) throw reason;
    }
  }
  return result;
}

export async function listImageObjectInventory(
  client: S3Client,
  prefix: string,
): Promise<{ pointer: StorageObjectPointer; contentType: string }[]> {
  const abortSignal = AbortSignal.timeout(60_000);
  // ponytail: one-time inventory buffers O(n) keys; batch metadata if large legacy owners require it.
  return readImageObjectInventory(
    client,
    await listByPrefix(client, prefix, { abortSignal }),
    abortSignal,
  );
}
