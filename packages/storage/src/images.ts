import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { parseRelativePath } from "@nojv/core";
import { createHash, randomUUID } from "node:crypto";

import { getStorageEnv } from "./env";
import { putImmutableObject, putObjectIfAbsent } from "./object";

let cachedBucket: string | undefined;
function BUCKET(): string {
  return (cachedBucket ??= getStorageEnv().S3_BUCKET);
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

function remoteImageKey(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return `remote-images/${hash}`;
}

async function readObject(client: S3Client, key: string): Promise<StoredImage> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: key,
    }),
  );
  const body = response.Body;
  if (!body) {
    throw new Error(`No body returned for object ${key}`);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return {
    body: Buffer.concat(chunks),
    contentType: response.ContentType ?? "application/octet-stream",
  };
}

export async function uploadProblemImage(
  client: S3Client,
  problemId: string,
  file: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `problems/${problemId}/images/${randomUUID()}.${ext}`;

  await putImmutableObject(client, key, file, { contentType: mimeType });

  return key;
}

export async function uploadUserContentImage(
  client: S3Client,
  userId: string,
  file: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `users/${userId}/images/${randomUUID()}.${ext}`;

  await putImmutableObject(client, key, file, { contentType: mimeType });

  return key;
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

export async function downloadRemoteImage(client: S3Client, url: string): Promise<StoredImage> {
  return readObject(client, remoteImageKey(url));
}

export async function cacheRemoteImage(
  client: S3Client,
  url: string,
  file: Buffer,
  mimeType: string,
): Promise<StoredImage> {
  const key = remoteImageKey(url);
  await putObjectIfAbsent(client, key, file, { contentType: mimeType });
  return readObject(client, key);
}
