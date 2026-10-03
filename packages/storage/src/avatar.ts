import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { parseRelativePath } from "@nojv/core";

import { getStorageEnv } from "./env";

let cachedBucket: string | undefined;
function BUCKET(): string {
  cachedBucket ??= getStorageEnv().S3_BUCKET;
  return cachedBucket;
}

function avatarKey(userId: string, filename: string): string {
  const parsed = parseRelativePath(filename);
  if (parsed.includes("/") || !parsed.endsWith(".webp")) {
    throw new Error("Avatar filename is invalid");
  }
  return `avatars/${userId}/${parsed}`;
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
