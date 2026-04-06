import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
