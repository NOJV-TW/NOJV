import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import { getStorageEnv } from "./env";

let cachedBucket: string | undefined;
function BUCKET(): string {
  return (cachedBucket ??= getStorageEnv().S3_BUCKET);
}

function avatarKey(userId: string): string {
  return `avatars/${userId}.webp`;
}

export async function uploadUserAvatar(
  client: S3Client,
  userId: string,
  file: Buffer,
): Promise<string> {
  const key = avatarKey(userId);

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: file,
      ContentType: "image/webp",
    }),
  );

  return key;
}

export async function downloadUserAvatar(client: S3Client, userId: string): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET(),
      Key: avatarKey(userId),
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

export async function deleteUserAvatar(client: S3Client, userId: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET(),
      Key: avatarKey(userId),
    }),
  );
}
