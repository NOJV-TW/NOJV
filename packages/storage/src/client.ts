import { S3Client } from "@aws-sdk/client-s3";

export function createStorageClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing S3 environment variables (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)",
    );
  }

  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}
