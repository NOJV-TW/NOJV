import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

import { getStorageBaseUrl } from "./client";

const BUCKET = process.env.S3_BUCKET ?? "nojv";

export async function uploadProblemImage(
  client: S3Client,
  problemId: string,
  file: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `problems/${problemId}/images/${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: mimeType,
    }),
  );

  return `${getStorageBaseUrl()}/${BUCKET}/${key}`;
}

export async function uploadUserContentImage(
  client: S3Client,
  userId: string,
  file: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `users/${userId}/images/${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: mimeType,
    }),
  );

  return `${getStorageBaseUrl()}/${BUCKET}/${key}`;
}

export async function deleteProblemImage(client: S3Client, imageUrl: string): Promise<void> {
  const url = new URL(imageUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const key = pathParts.slice(1).join("/");

  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

export async function uploadAdvancedImageTarball(
  client: S3Client,
  problemId: string,
  file: Buffer,
): Promise<string> {
  const key = `problems/${problemId}/advanced-images/${randomUUID()}.tar`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: "application/x-tar",
    }),
  );

  return key;
}

export async function deleteAdvancedImageTarball(client: S3Client, key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

export async function downloadAdvancedImageTarball(
  client: S3Client,
  key: string,
): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
  const body = response.Body;
  if (!body) {
    throw new Error(`No body returned for advanced image tarball ${key}`);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
