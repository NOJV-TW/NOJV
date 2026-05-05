import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET ?? "nojv";

function avatarKey(userId: string): string {
  return `avatars/${userId}.webp`;
}

/**
 * Uploads (or overwrites) the avatar at `avatars/{userId}.webp`.
 * Returns a public URL with a `?v={timestamp}` cache-buster so the browser
 * picks up the new image immediately even though the storage key is stable.
 */
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

  const baseUrl = process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT ?? "";
  return `${baseUrl}/${BUCKET}/${key}?v=${String(Date.now())}`;
}

export async function deleteUserAvatar(client: S3Client, userId: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: avatarKey(userId),
    }),
  );
}
