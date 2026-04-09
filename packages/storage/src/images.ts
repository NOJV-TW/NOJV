import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const BUCKET = process.env.S3_BUCKET ?? "nojv";

export async function uploadProblemImage(
  client: S3Client,
  problemId: string,
  file: Buffer,
  mimeType: string
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `problems/${problemId}/images/${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: mimeType
    })
  );

  const baseUrl = process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT ?? "";
  return `${baseUrl}/${BUCKET}/${key}`;
}

export async function deleteProblemImage(client: S3Client, imageUrl: string): Promise<void> {
  // Extract key from URL: {baseUrl}/{bucket}/{key}
  const url = new URL(imageUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // First part is bucket name, rest is key
  const key = pathParts.slice(1).join("/");

  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key
    })
  );
}

/**
 * Phase 7 Advanced Mode: upload a TA-provided judge image as a
 * Docker tarball. Callers receive an opaque S3 key that can be
 * stored on Problem.advancedImageRef and later resolved back into a
 * signed URL or pulled to disk by the worker before `docker load`.
 */
export async function uploadAdvancedImageTarball(
  client: S3Client,
  problemId: string,
  file: Buffer
): Promise<string> {
  const key = `problems/${problemId}/advanced-images/${randomUUID()}.tar`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file,
      ContentType: "application/x-tar"
    })
  );

  return key;
}

export async function deleteAdvancedImageTarball(client: S3Client, key: string): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key
    })
  );
}

/**
 * Stream an advanced-image tarball out of object storage. Returns the
 * raw bytes — callers are responsible for piping them into `docker
 * load` or writing to disk first.
 */
export async function downloadAdvancedImageTarball(
  client: S3Client,
  key: string
): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    })
  );
  const body = response.Body;
  if (!body) {
    throw new Error(`No body returned for advanced image tarball ${key}`);
  }
  // AWS SDK returns a readable stream; collect into a buffer.
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
