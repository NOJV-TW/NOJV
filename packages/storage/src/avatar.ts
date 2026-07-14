import { randomUUID } from "node:crypto";

import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { parseRelativePath } from "@nojv/core";

import { getStorageEnv } from "./env";
import { putImmutableObject } from "./object";

let cachedBucket: string | undefined;
function BUCKET(): string {
  return (cachedBucket ??= getStorageEnv().S3_BUCKET);
}

function avatarKey(userId: string, filename: string): string {
  const parsed = parseRelativePath(filename);
  if (parsed.includes("/") || !parsed.endsWith(".webp")) {
    throw new Error("Avatar filename is invalid");
  }
  return `avatars/${userId}/${parsed}`;
}

export async function uploadUserAvatar(
  client: S3Client,
  userId: string,
  file: Buffer,
): Promise<string> {
  const key = avatarKey(userId, `${randomUUID()}.webp`);
  await putImmutableObject(client, key, file, { contentType: "image/webp" });

  return key;
}

export async function downloadUserAvatar(
  client: S3Client,
  userId: string,
  filename: string,
): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: avatarKey(userId, filename),
    }),
  );
  const body = response.Body;
  if (!body) {
    throw new Error(`No body returned for avatar ${userId}`);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteUserAvatar(
  client: S3Client,
  userId: string,
  filename: string,
): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET(),
      Key: avatarKey(userId, filename),
    }),
  );
}
