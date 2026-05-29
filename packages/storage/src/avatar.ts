import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import { getStorageBaseUrl } from "./client";

const BUCKET = process.env.S3_BUCKET ?? "nojv";

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
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: "image/webp",
    }),
  );

  return `${getStorageBaseUrl()}/${BUCKET}/${key}?v=${String(Date.now())}`;
}

export async function deleteUserAvatar(client: S3Client, userId: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: avatarKey(userId),
    }),
  );
}
